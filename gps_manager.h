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

#ifndef __GPS_MANAGER_H__
#define __GPS_MANAGER_H__

#include "config.hpp"

#include <pthread.h>

#include "packetchain.h"
#include "globalregistry.h"
#include "kis_net_microhttpd.h"

class Kis_Gps;

// Packet info attached to each packet, if there isn't already GPS info present
class kis_gps_packinfo : public packet_component {
public:
	kis_gps_packinfo() {
		self_destruct = 1;
        lat = lon = alt = speed = heading = 0;
        precision = 0;
		fix = 0;
        time = 0;
	}

    kis_gps_packinfo(kis_gps_packinfo *src) {
        if (src == NULL) {

        } else {
            self_destruct = src->self_destruct;
            lat = src->lat;
            lon = src->lon;
            alt = src->alt;
            speed = src->speed;
            heading = src->heading;
            precision = src->precision;
            fix = src->fix;
            time = src->time;
            gpsname = src->gpsname;
        }
    }

    double lat;
    double lon;
    double alt;
    double speed;
    double heading;

    // If we know it, how accurate our location is, in meters
    double precision;

    // If we know it, 2d vs 3d fix
    int fix;

    time_t time;

    // GPS that created us
    string gpsname;
};

/* GPS manager which handles configuring GPS sources and deciding which one
 * is going to be used */
class GpsManager : public Kis_Net_Httpd_Stream_Handler, public LifetimeGlobal {
public:
    static shared_ptr<GpsManager> create_gpsmanager(GlobalRegistry *in_globalreg) {
        shared_ptr<GpsManager> mon(new GpsManager(in_globalreg));
        in_globalreg->RegisterLifetimeGlobal(mon);
        in_globalreg->InsertGlobal("GPS_MANAGER", mon);
        return mon;
    }

private:
    GpsManager(GlobalRegistry *in_globalreg);

public:
    virtual ~GpsManager();

    virtual bool Httpd_VerifyPath(const char *path, const char *method);

    virtual void Httpd_CreateStreamResponse(Kis_Net_Httpd *httpd,
            Kis_Net_Httpd_Connection *connection,
            const char *url, const char *method, const char *upload_data,
            size_t *upload_data_size, std::stringstream &stream);

    // Register prototype builders for different GPS sources
    void RegisterGpsPrototype(string in_name, string in_desc, 
            Kis_Gps *in_builder, int in_priority);
    void RemoveGpsPrototype(string in_name);

    // Create a GPS instance
    unsigned int CreateGps(string in_gpsconfig);

    // Remove a GPS instance
    void RemoveGps(unsigned int in_id);

    // Get the best location if we have multiple GPS devices
    kis_gps_packinfo *GetBestLocation();

    static int kis_gpspack_hook(CHAINCALL_PARMS);

protected:
    GlobalRegistry *globalreg;

    pthread_mutex_t manager_locker;

    // Prototype GPS devices we can activate
    class gps_prototype {
    public:
        string type_name;
        string description;
        Kis_Gps *builder;
        int priority;
    };
    map<string, gps_prototype *> prototype_map;

    // Basic priority-monitored list of GPS
    class gps_instance {
    public:
        Kis_Gps *gps;
        string type_name;
        int priority;
        unsigned int id;
    };
    vector<gps_instance *> instance_vec;
    unsigned int next_gps_id;

};

#endif

