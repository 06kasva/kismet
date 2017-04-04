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

#include "config.hpp"

#include <unistd.h>
#include "globalregistry.h"
#include "util.h"
#include "macaddr.h"

#include "dumpfile.h"

GlobalRegistry::GlobalRegistry() { 
	fatal_condition = 0;
	spindown = 0;

	kismet_instance = KISMET_INSTANCE_SERVER;

	winch = false;

	argc = 0;
	argv = NULL;
	envp = NULL;

	getopt_long_num = 127;

	next_ext_ref = 0;

	messagebus = NULL;
	plugintracker = NULL;
	sourcetracker = NULL;
	netracker = NULL;
	packetchain = NULL;
	alertracker = NULL;
	timetracker = NULL;
	kisnetserver = NULL;
	kisdroneserver = NULL;
	kismet_config = NULL;
	kismetui_config = NULL;
	soundctl = NULL;
	builtindissector = NULL;
	rootipc = NULL;
	panel_interface = NULL;
	manufdb = NULL;

	start_time = 0;

	for (int x = 0; x < PROTO_REF_MAX; x++)
		netproto_map[x] = -1;

	filter_tracker = 0;
	filter_tracker_bssid_invert = -1;
	filter_tracker_source_invert = -1;
	filter_tracker_dest_invert = -1;

	filter_dump = 0;
	filter_dump_bssid_invert = -1;
	filter_dump_source_invert = -1;
	filter_dump_dest_invert = -1;

	filter_export = 0;
	filter_export_bssid_invert = -1;
	filter_export_source_invert = -1;
	filter_export_dest_invert = -1;

	broadcast_mac = mac_addr("FF:FF:FF:FF:FF:FF");
	empty_mac = mac_addr(0);

	alert_backlog = 0;

	for (unsigned int x = 0; x < PACK_COMP_MAX; x++)
		packetcomp_map[x] = -1;

	for (unsigned int x = 0; x < ALERT_REF_MAX; x++)
		alertref_map[x] = -1;

	pcapdump = NULL;

	nlhandle = NULL;

	checksum_packets = 0;
}

// External globals -- allow other things to tie structs to us
int GlobalRegistry::RegisterGlobal(string in_name) {
	map<string, int>::iterator i;

	if ((i = ext_name_map.find(StrLower(in_name))) != ext_name_map.end())
		return i->second;

	next_ext_ref++;

	ext_name_map[StrLower(in_name)] = next_ext_ref;

	return next_ext_ref;
}

int GlobalRegistry::FetchGlobalRef(string in_name) {
	if (ext_name_map.find(StrLower(in_name)) == ext_name_map.end())
		return -1;

	return ext_name_map[StrLower(in_name)];
}

shared_ptr<void> GlobalRegistry::FetchGlobal(int in_ref) {
	if (ext_data_map.find(in_ref) == ext_data_map.end())
		return NULL;

	return ext_data_map[in_ref];
}

shared_ptr<void> GlobalRegistry::FetchGlobal(string in_name) {
	int ref;

	if ((ref = FetchGlobalRef(in_name)) < 0) {
		return NULL;
	}

	return ext_data_map[ref];
}

int GlobalRegistry::InsertGlobal(int in_ref, shared_ptr<void> in_data) {
	/*
	if (ext_data_map.find(in_ref) == ext_data_map.end()) {
		fprintf(stderr, "debug - insertglobal no ref %d\n", in_ref);
		return -1;
	}
	*/

	ext_data_map[in_ref] = in_data;

	return 1;
}

void GlobalRegistry::RemoveGlobal(int in_ref) {
    if (ext_data_map.find(in_ref) != ext_data_map.end()) {
        ext_data_map.erase(ext_data_map.find(in_ref));
    }
}

int GlobalRegistry::InsertGlobal(string in_name, shared_ptr<void> in_data) {
	int ref = RegisterGlobal(in_name);

	return InsertGlobal(ref, in_data);
}

void GlobalRegistry::RemoveGlobal(string in_name) {
    int ref = FetchGlobalRef(in_name);
    RemoveGlobal(ref);
}

void GlobalRegistry::RegisterDumpFile(Dumpfile *in_dump) {
	subsys_dumpfile_vec.push_back(in_dump);
}

int GlobalRegistry::RemoveDumpFile(Dumpfile *in_dump) {
	for (unsigned int x = 0; x < subsys_dumpfile_vec.size(); x++) {
		if (subsys_dumpfile_vec[x] == in_dump) {
			subsys_dumpfile_vec.erase(subsys_dumpfile_vec.begin() + x);
			return 1;
		}
	}
	return 0;
}

Dumpfile *GlobalRegistry::FindDumpFileType(string in_type) {
	string type = StrUpper(in_type);
	for (unsigned int x = 0; x < subsys_dumpfile_vec.size(); x++) {
		if (StrUpper(subsys_dumpfile_vec[x]->FetchFileType()) == type) {
			return subsys_dumpfile_vec[x];
		}
	}

	return NULL;
}

void GlobalRegistry::AddNamedFd(string in_name, int fd) {
	string un = StrUpper(in_name);

	namedfd_map[un] = fd;
}

int GlobalRegistry::GetNamedFd(string in_name) {
	string un = StrUpper(in_name);

	if (namedfd_map.find(un) != namedfd_map.end()) {
		return namedfd_map.find(un)->second;
	}

	return -1;
}

void GlobalRegistry::RegisterUsageFunc(usage_func in_cli) {
    usage_func_vec.push_back(in_cli);
}

void GlobalRegistry::RemoveUsageFunc(usage_func in_cli) {
    for (vector<usage_func>::iterator i = usage_func_vec.begin();
            i != usage_func_vec.end(); ++i) {
        if ((*i) == in_cli) {
            usage_func_vec.erase(i);
            return;
        }
    }
}

void GlobalRegistry::RegisterLifetimeGlobal(shared_ptr<LifetimeGlobal> in_g) {
    lifetime_vec.insert(lifetime_vec.begin(), in_g);
}

void GlobalRegistry::RemoveLifetimeGlobal(shared_ptr<LifetimeGlobal> in_g) {
    for (vector<shared_ptr<LifetimeGlobal> >::iterator i = lifetime_vec.begin();
            i != lifetime_vec.end(); ++i) {
        if (*i == in_g) {
            lifetime_vec.erase(i);
            break;
        }
    }
}

void GlobalRegistry::DeleteLifetimeGlobals() {
	for (vector<shared_ptr<LifetimeGlobal> >::iterator i = lifetime_vec.begin();
			i != lifetime_vec.end(); ++i) {
		lifetime_vec.erase(i);
		i = lifetime_vec.begin();
	}

    lifetime_vec.clear();
}

