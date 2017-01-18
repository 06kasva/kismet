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

#ifndef __MSGPACK_ADAPTER_H__
#define __MSGPACK_ADAPTER_H__

#include "config.h"

#include <stdio.h>
#include <time.h>
#include <list>
#include <map>
#include <vector>
#include <algorithm>
#include <string>
#include <msgpack.hpp>

#include "globalregistry.h"
#include "trackedelement.h"

namespace MsgpackAdapter {

typedef map<string, msgpack::object> MsgpackStrMap;

void Packer(GlobalRegistry *globalreg, SharedTrackerElement v, 
        msgpack::packer<std::stringstream> &packer);

void Pack(GlobalRegistry *globalreg, std::stringstream &stream, 
        SharedTrackerElement e);

class Serializer : public TrackerElementSerializer {
public:
    Serializer(GlobalRegistry *in_globalreg, std::stringstream &in_stream) : 
        TrackerElementSerializer(in_globalreg, in_stream) { }

    virtual void serialize(SharedTrackerElement in_elem) {
        Pack(globalreg, stream, in_elem);
    }
};

// Convert to std::vector<std::string>.  MAY THROW EXCEPTIONS.
void AsStringVector(msgpack::object &obj, std::vector<std::string> &vec);

}

#endif

