/*
    This file is part of Kismet

    Kismet is free software; you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 2 of the License, or
    (at your option) any later version.

    Kismet is distributed in the hope that it will be useful,
      but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with Kismet; if not, write to the Free Software
    Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
*/

#include "config.h"

#include "globalregistry.h"
#include "kis_net_microhttpd.h"
#include "messagebus.h"
#include "gps_manager.h"
#include "kis_gps.h"
#include "configfile.h"

#include "gpsserial2.h"
#include "gpsgpsd2.h"
#include "gpsfake.h"
#include "gpsweb.h"

GpsManager::GpsManager(GlobalRegistry *in_globalreg) :
    Kis_Net_Httpd_Stream_Handler(in_globalreg) {

    globalreg = in_globalreg;

    httpd->RegisterHandler(this);

    pthread_mutex_init(&manager_locker, NULL);

    next_gps_id = 1;

    // Register the gps component
    _PCM(PACK_COMP_GPS) =
        globalreg->packetchain->RegisterPacketComponent("gps");

    // Register the packet chain hook
    globalreg->packetchain->RegisterHandler(&kis_gpspack_hook, this,
            CHAINPOS_POSTCAP, -100);

    // Register the built-in GPS drivers
    RegisterGpsPrototype("serial", "serial attached", 
            new GPSSerialV2(globalreg), 100);
    RegisterGpsPrototype("gpsd", "gpsd network-attached", 
            new GPSGpsdV2(globalreg), 99);
    RegisterGpsPrototype("virtual", "virtual gps with fixed location",
            new GPSFake(globalreg), 0);
    RegisterGpsPrototype("web", "browser-based location",
            new GPSWeb(globalreg), 50);

    // Process any gps options in the config file
    vector<string> gpsvec = 
        globalreg->kismet_config->FetchOptVec("gps");
    for (unsigned int x = 0; x < gpsvec.size(); x++) {
        CreateGps(gpsvec[x]);
    }
}

GpsManager::~GpsManager() {
    {
        local_locker lock(&manager_locker);
        globalreg->RemoveGlobal("GPS_MANAGER");
        httpd->RemoveHandler(this);

        map<string, gps_prototype *>::iterator i;
        for (i = prototype_map.begin(); i != prototype_map.end(); ++i) {
            delete i->second->builder;
            delete i->second;
        }

        vector<gps_instance *>::iterator ii;
        for (ii = instance_vec.begin(); ii != instance_vec.end(); ++ii) {
            delete((*ii)->gps);
            delete(*ii);
        }

        globalreg->packetchain->RemoveHandler(&kis_gpspack_hook, CHAINPOS_POSTCAP);
    }

    pthread_mutex_destroy(&manager_locker);
}

void GpsManager::RegisterGpsPrototype(string in_name, string in_desc,
        Kis_Gps *in_builder,
        int in_priority) {
    local_locker lock(&manager_locker);

    string lname = StrLower(in_name);

    map<string, gps_prototype *>::iterator i = prototype_map.find(lname);

    if (i != prototype_map.end()) {
        _MSG("GpsManager tried to register GPS type " + in_name + " but it "
                "already exists", MSGFLAG_ERROR);
        return;
    }

    gps_prototype *proto = new gps_prototype();

    proto->type_name = in_name;
    proto->description = in_desc;
    proto->builder = in_builder;
    proto->priority = in_priority;

    prototype_map[lname] = proto;

    return;
}

void GpsManager::RemoveGpsPrototype(string in_name) {
    local_locker lock(&manager_locker);

    string lname = StrLower(in_name);
    map<string, gps_prototype *>::iterator i = prototype_map.find(lname);

    if (i == prototype_map.end())
        return;

    delete i->second->builder;
    delete i->second;
    prototype_map.erase(i);
}

unsigned int GpsManager::CreateGps(string in_gpsconfig) {
    local_locker lock(&manager_locker);

    vector<string> optvec = StrTokenize(in_gpsconfig, ":");

    if (optvec.size() != 2) {
        _MSG("GpsManager expected type:option1=value,option2=value style "
                "options.", MSGFLAG_ERROR);
        return 0;
    }

    string ltname = StrLower(optvec[0]);
    string in_opts = optvec[1];

    map<string, gps_prototype *>::iterator i = prototype_map.find(ltname);

    if (i == prototype_map.end()) {
        _MSG("GpsManager tried to create a GPS of type " + ltname + 
                "but that type doesn't exist", MSGFLAG_ERROR);
        return 0;
    }

    Kis_Gps *gps = i->second->builder->BuildGps(in_opts);
    if (gps == NULL) {
        _MSG("GpsManager failed to create a GPS of type " + ltname + 
                "(" + in_opts + ")", MSGFLAG_ERROR);
        return 0;
    }

    gps_instance *instance = new gps_instance;
    instance->gps = gps;
    instance->type_name = ltname;
    instance->priority = i->second->priority;
    instance->id = next_gps_id++;

    if (instance_vec.size() == 0) {
        instance_vec.push_back(instance);
    } else {
        // Insert at priority
        bool inserted = false;
        for (unsigned int i = 0; i < instance_vec.size(); i++) {
            // Higher priority goes earlier)
            if (instance->priority > instance_vec[i]->priority) {
                instance_vec.insert(instance_vec.begin() + i, instance);
                inserted = true;
                break;
            }
        }

        if (!inserted) 
            instance_vec.push_back(instance);
    }

    return instance->id;
}

void GpsManager::RemoveGps(unsigned int in_id) {
    local_locker lock(&manager_locker);

    gps_instance *instance = NULL;
    unsigned int pos = 0;
    for (unsigned int x = 0; x < instance_vec.size(); x++) {
        if (instance_vec[x]->id == in_id) {
            instance = instance_vec[x];
            pos = x;
            break;
        }
    }

    if (instance == NULL) {
        _MSG("GpsManager can't remove a GPS (id: " + UIntToString(in_id) + 
                ") as it doesn't exist.", MSGFLAG_ERROR);
        return;
    }

    delete instance->gps;
    delete instance;

    instance_vec.erase(instance_vec.begin() + pos);
}

kis_gps_packinfo *GpsManager::GetBestLocation() {
    local_locker lock(&manager_locker);

    kis_gps_packinfo *location = NULL;

    for (unsigned int i = 0; i < instance_vec.size(); i++) {
        if (instance_vec[i]->gps->FetchGpsLocationValid()) {
            location = instance_vec[i]->gps->FetchGpsLocation();
            break;
        }
    }

    return location;
}

int GpsManager::kis_gpspack_hook(CHAINCALL_PARMS) {
    // We're an 'external user' of gpsmanager despite being inside it,
    // so don't do thread locking - that's up to gpsmanager internals
    
    GpsManager *gpsmanager = (GpsManager *) auxdata;

    // Don't override if this packet already has a location, which could
    // come from a drone or from a PPI file
    if (in_pack->fetch(_PCM(PACK_COMP_GPS)) != NULL)
        return 1;

    kis_gps_packinfo *gpsloc = gpsmanager->GetBestLocation();

    if (gpsloc == NULL)
        return 0;

    // Insert a new gps location so the chain isn't tied to our gps instance
    in_pack->insert(_PCM(PACK_COMP_GPS), new kis_gps_packinfo(gpsloc));

    return 1;
}

bool GpsManager::Httpd_VerifyPath(const char *path, const char *method) {
    if (strcmp(method, "GET") != 0)
        return false;

    return false;
}

void GpsManager::Httpd_CreateStreamResponse(
        Kis_Net_Httpd *httpd __attribute__((unused)),
        Kis_Net_Httpd_Connection *connection __attribute__((unused)),
        const char *path, const char *method, 
        const char *upload_data __attribute__((unused)),
        size_t *upload_data_size __attribute__((unused)), 
        std::stringstream &stream) {

    return;
}

