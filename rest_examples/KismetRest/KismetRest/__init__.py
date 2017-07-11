#!/usr/bin/env python

import msgpack
import requests
import base64
import os

"""
Field Specification:

    Several endpoints in Kismet take a field filtering object.  These
    use a common specification:

    [
        field1,
        ...
        fieldN
    ]

    where a field may be a single-element string, consisting of a
    field name -or- a field path, such as:
        'kismet.device.base.channel'
        'kismet.device.base.signal/kismet.common.signal.last_signal_dbm'

    OR a field may be a two-value array, consisting of a field name or
    path, and a target name the field will be aliased to:

        ['kismet.device.base.channel', 'base.channel']
        ['kismet.device.base.signal/kismet.common.signal.last_signal_dbm', 
            'last.signal']

    The fields in the returned device will be inserted as their final
    name - that is, from the first above example, the device will contain
        'kismet.device.base.channel' and 'kismet.common.signal.last_signal_dbm'
    and from the second example:
        'base.channel' and 'last.signal'

Filter Specification:

    Several endpoints in Kismet take a regex object.  These use a common
    specification:

    [
        [ multifield, regex ],
        ...
        [ multifield, regex ]
    ]

    Multifield is a field path specification which will automatically expand
    value-maps and vectors found in the path.  For example, the multifield
    path:
        'dot11.device/dot11.device.advertised_ssid_map/dot11.advertisedssid.ssid'
    
    would apply to all 'dot11.advertisedssid.ssid' fields in the ssid_map 
    automatically.

    Regex is a basic string containing a regular expression, compatible with
    PCRE.

    To match on SSIDs:

    regex = [
        [ 'dot11.device/dot11.device.advertised_ssid_map/dot11.advertisedssid.ssid',
            '^SomePrefix.*' ]
        ]

    A device is included in the results if it matches any of the regular 
    expressions.

"""


class KismetConnectorException(Exception):
    """
    Custom exception handler
    """
    pass


class KismetConnector:
    """
    Kismet rest API
    """
    def __init__(self, host_uri='http://127.0.0.1:2501'):
        """ 
        KismetRest(hosturi) -> KismetRest

        hosturi: URI including protocol, host, and port

        Example:
        rest = KismetRest('https://localhost:2501/')

        """
        self.debug = False

        self.host_uri = host_uri

        self.TRACKER_STRING = 0
        self.TRACKER_INT8 = 1
        self.TRACKER_UINT8 = 2
        self.TRACKER_INT16 = 3
        self.TRACKER_UINT16 = 4
        self.TRACKER_INT32 = 5
        self.TRACKER_UINT32 = 6
        self.TRACKER_INT64 = 7
        self.TRACKER_UINT64 = 8
        self.TRACKER_FLOAT = 9
        self.TRACKER_DOUBLE = 10
        self.TRACKER_MAC = 11
        self.TRACKER_UUID = 12
        self.TRACKER_VECTOR = 13
        self.TRACKER_MAP = 14
        self.TRACKER_INTMAP = 15
        self.TRACKER_MACMAP = 16
        self.TRACKER_STRINGMAP = 17
        self.TRACKER_DOUBLEMAP = 18

        self.username = "unknown"
        self.password = "nopass"

        self.session = requests.Session()

        # Set the default path for storing sessions
        self.sessioncache_path = None
        self.set_session_cache("~/.pykismet_session")

    def set_debug(self, debug):
        """
        SetDebug(debug) -> None

        Set debug mode (more verbose output)
        """
        self.debug = debug

    def set_login(self, user, passwd):
        """
        SetLogin(user, passwd) -> None

        Logs in (and caches login credentials).  Required for administrative
        behavior.
        """
        self.session.auth = (user, passwd)

        return 

    def set_session_cache(self, path):
        """
        SetSessionCache(self, path) -> None

        Set a cache file for HTTP sessions
        """
        self.sessioncache_path = os.path.expanduser(path)

        # If we already have a session cache file here, load it
        if os.path.isfile(self.sessioncache_path):
            try:
                lcachef = open(self.sessioncache_path, "r")
                cookie = lcachef.read()

                # Add the session cookie
                requests.utils.add_dict_to_cookiejar(
                    self.session.cookies, {"KISMET": cookie})

                lcachef.close()
            except Exception as e:
                print "Failed to read session cache:", e

    def __simplify(self, unpacked):
        """
        __simplify(unpacked_object) -> Python object
        Strip out Kismet type data and return a simplified Python
        object

        unpacked: Python object unpacked from Kismet message
        """

        if unpacked[0] == self.TRACKER_VECTOR:
            retarr = []

            for x in range(0, len(unpacked[1])):
                retarr.append(self.__simplify(unpacked[1][x]))

            return retarr

        if (unpacked[0] == self.TRACKER_MAP or unpacked[0] == self.TRACKER_INTMAP or
                unpacked[0] == self.TRACKER_MACMAP or 
                unpacked[0] == self.TRACKER_STRINGMAP or
                unpacked[0] == self.TRACKER_DOUBLEMAP):

            retdict = {}

            for k in unpacked[1].keys():
                retdict[k] = self.__simplify(unpacked[1][k])

            return retdict

        if unpacked[0] == self.TRACKER_MAC:
            return unpacked[1][0]

        return unpacked[1]

    def __unpack_url(self, url):
        """
        __unpack_url(url) -> Unpacked Object

        Unpacks a msgpack object at a given URL, inside the provided host URI
        """
        try:
            r = self.session.get("%s/%s" % (self.host_uri, url))
            if not r.status_code == 200:
                print "Did not get 200 OK: {} {}".format(url, r.status_code)
                return None
            urlbin = r.content
        except Exception as e:
            print "Failed to get object: ", e
            return None

        try:
            cd = requests.utils.dict_from_cookiejar(self.session.cookies)
            if "KISMET" in cd:
                cookie = cd["KISMET"]
                if (len(cookie) != 0):
                    lcachef = open(self.sessioncache_path, "w")
                    lcachef.write(cookie)
                    lcachef.close()
        except Exception as e:
            print "Failed to save session:", e

        try:
            obj = msgpack.unpackb(urlbin)
        except Exception as e:
            print "Failed to unpack object: ", e
            return None

        return obj

    def __unpack_simple_url(self, url):
        """
        __unpack_simple_url(url) -> Python Object

        Unpacks a msgpack object and returns the simplified python object
        """
        cobj = self.__unpack_url(url)

        if cobj == None:
            return {}

        return self.__simplify(cobj)

    def get_url(self, url):
        """
        get_url(url) -> Simple string

        Fetches a response from the Kismet server at a given URL and returns
        it as a string object
        """
        try:
            r = self.session.get("%s/%s" % (self.host_uri, url))
            if not r.status_code == 200:
                print "Did not get 200 OK: {} {}".format(url, r.status_code)
                return (False, r.content)
        except Exception as e:
            print "Failed to get object: ", e
            return (False, None)

        return (True, r.content)

    def post_url(self, url, postdata):
        """
        post_url(url, postdata) -> Boolean

        Post data to a URL.  Automatically attempt to log in if we are not 
        current logged in.
        """

        if self.debug:
            print "Posting to URL %s/%s" % (self.host_uri, url)

        r = self.session.post("%s/%s" % (self.host_uri, url), data=postdata)

        if self.debug:
            print "Got status code ", r.status_code

        # login required
        if r.status_code == 401:
            # Can we log in?
            if not self.login():
                return (False, None)

            if self.debug:
                print "Logged in, retrying post"

            # Try again after we log in
            r = self.session.post("%s/%s" % (self.host_uri, url), data=postdata)

        if self.debug:
            print "Got status code ", r.status_code

        # Did we succeed?
        if not r.status_code == 200:
            if self.debug:
                print "Post failed:", r.content
            return (False, None)

        # Save the session
        try:
            cd = requests.utils.dict_from_cookiejar(self.session.cookies)
            cookie = cd["KISMET"]
            if (len(cookie) != 0):
                lcachef = open(self.sessioncache_path, "w")
                lcachef.write(cookie)
                lcachef.close()
        except Exception as e:
            print "Failed to save session:", e
            x = 1

        return (True, r.content)

    def post_msgpack_url(self, url, postdata):
        """
        post_msgpack_url(url, postdata) -> Boolean

        Post an encoded msgpack command to a URL.  Automatically attempt to log in
        if we are not current logged in.
        """

        if self.debug:
            print "Posting to MSGPACK URL %s/%s" % (self.host_uri, url)

        try:
            finaldata = {
                    "msgpack": base64.b64encode(msgpack.packb(postdata))
                    }
        except Exception as e:
            if self.debug:
                print "Failed to encode post data:", e
            return (False, None)

        return self.post_url(url, postdata=finaldata)

    def login(self):
        """
        login() -> Boolean

        Logs in (and caches login credentials).  Required for administrative
        behavior.
        """
        r = self.session.get("%s/session/check_session" % self.host_uri)

        if not r.status_code == 200:
            print "Invalid session"
            return False

        # Save the session
        try:
            lcachef = open(self.sessioncache_path, "w")
            cd = requests.utils.dict_from_cookiejar(self.session.cookies)
            cookie = cd["KISMET"]
            lcachef.write(cookie)
            lcachef.close()
        except Exception as e:
            print "Failed to save session:", e
            x = 1

        return True

    def check_session(self):
        """
        check_session() -> Boolean

        Checks if a session is valid / session is logged in
        """

        r = self.session.get("%s/session/check_session" % self.host_uri)

        if not r.status_code == 200:
            return False

        # Save the session
        try:
            lcachef = open(self.sessioncache_path, "w")
            cd = requests.utils.dict_from_cookiejar(self.session.cookies)
            cookie = cd["KISMET"]
            lcachef.write(cookie)
            lcachef.close()
        except Exception as e:
            print "Failed to save session:", e
            x = 1


        return True

    def system_status(self):
        """
        system_status() -> Status object

        Return fetch the system status
        """
        return self.__unpack_simple_url("system/status.msgpack")

    def device_summary(self):
        """
        device_summary() -> device summary list

        Return summary of all devices
        """
        return self.__unpack_simple_url("devices/all_devices.msgpack")

    def device_summary_since(self, ts):
        """
        device_summary_since(ts) -> device summary list 

        Return object containing summary of devices added or changed since ts
        and ts info
        """
        return self.__unpack_simple_url("devices/last-time/{}/devices.msgpack".format(ts))

    def smart_summary_since(self, ts, fields, regex = None):
        """
        smart_summary_since(ts, fields) -> device summary list

        Return object containing summary of devices added or changed since ts
        and ts info.  Restricted summary to provided vector of fields defined by
        the fieldspec.

        Optionally filter responses and return only responses which match the
        regex defined by the filterspec
        """

        cmd = {
                "fields": fields,
                }

        if not regex == None:
            cmd["regex"] = regex;

        (r, v) = self.post_msgpack_url("devices/last-time/{}/devices.msgpack".format(ts), cmd)

        # Did we succeed?
        if not r:
            if self.debug:
                print "Failed to post smart summary: ", r
            return False

        try:
            obj = msgpack.unpackb(v)
        except Exception as e:
            if self.debug:
                print "Failed to unpack object: ", e
            return list()

        return self.__simplify(obj)

    def device(self, key):
        """
        device(key) -> device object

        Return complete device object of device referenced by key
        """
        return self.__unpack_simple_url("devices/by-key/{}/device.msgpack".format(key))

    def device_field(self, key, field):
        """
        device_field(key, path) -> Field object

        Return specific field of a device referenced by key.

        field: Kismet tracked field path, ex:
            dot11.device/dot11.device.last_beaconed_ssid
        """
        return self.__unpack_simple_url("devices/by-key/{}/device.msgpack/{}".format(key, field))

    def device_by_mac(self, mac):
        """
        device_by_mac(mac) -> vector of device objects

        Return a vector of all devices in all phy types matching the supplied MAC
        address
        """
        return self.__unpack_simple_url("devices/by-mac/{}/devices.msgpack".format(mac))

    def datasources(self):
        """
        datasources() -> Datasource list
        
        Return list of all datasources
        """

        return self.__unpack_simple_url("datasource/all_sources.msgpack");

    def config_datasource_set_channel(self, uuid, channel):
        """
        config_datasource_set_channel(uuid, hop, channel) -> Boolean

        Locks an data source to an 802.11 channel or frequency.  Channel
        may be complex channel such as "6HT40+".

        Requires valid login.
        """

        cmd = {
            "channel": channel
        }

        (r, v) = self.post_msgpack_url("datasource/by-uuid/{}/set_channel.cmd".format(uuid), cmd)

        if not r:
            return False

        return True

    def config_datasource_set_hop_rate(self, uuid, rate):
        """
        config_datasource_set_hop_rate(uuid, rate)

        Configures the hopping rate of a data source, while not changing the
        channels used for hopping.

        Requires valid login
        """

        cmd = {
            "hoprate": rate
        }

        (r, v) = self.post_msgpack_url("datasource/by-uuid/{}/set_channel.cmd".format(uuid), cmd)

        if not r:
            return False

        return True


    def config_datasource_set_hop_channels(self, uuid, rate, channels):
        """
        config_datasource_set_hop(uuid, rate, channels)

        Configures a data source for hopping at 'rate' over a vector of
        channels.
        
        Requires valid login
        """

        cmd = {
            "hoprate": rate,
            "channels": channels
        }

        (r, v) = self.post_msgpack_url("datasource/by-uuid/{}/set_channel.cmd".format(uuid), cmd)

        if not r:
            return False

        return True

    def config_datasource_set_hop(self, uuid):
        """
        config_datasource_set_hop(uuid)

        Configure a source for hopping; uses existing source hop / channel list / etc
        attributes.

        Requires valid login
        """

        cmd = {
            "hop": True
        }

        (r, v) = self.post_msgpack_url("datasource/by-uuid/{}/set_hop.cmd".format(uuid), cmd)

        if not r:
            return False

        return True

    def add_datasource(self, source):
        """
        add_datasource(sourceline) -> Boolean

        Add a new source to kismet.  sourceline
        is a standard source definition.

        Requires valid login.

        Returns success
        """

        cmd = {
            "definition": source
        }

        (r, v) = self.post_msgpack_url("datasource/add_source.cmd", cmd)

        if not r:
            if self.debug:
                print "Could not add source", v

            return False

        return True

    def send_gps(self, lat, lon, alt, speed):
        """
        SendGPS(lat, lon, alt, speed) -> Boolean

        Sends a GPS position over the HTTP POST interface.

        Requires valid login.

        Returns success or failure.
        """

        cmd = {
                "lat": lat,
                "lon": lon,
                "alt": alt,
                "spd": speed
                }

        (r, v) = self.post_msgpack_url("gps/web/update.cmd", cmd)

        # Did we succeed?
        if not r:
            print "GPS update failed"
            return False

        return True

    def device_filtered_dot11_summary(self, pcre, fields = None):
        """
        device_filtered_dot11_summary() -> device summary list, filtered by
        dot11 ssid

        Return summary of all devices that match filter terms
        """

        cmd = {
                "essid": pcre
                }

        if fields != None:
            cmd["fields"] = fields

        (r, v) = self.post_msgpack_url("phy/phy80211/ssid_regex.cmd", cmd)
        if not r:
            print "Could not fetch summary"

            if self.debug:
                print "Error: ", v

            return list()

        try:
            obj = msgpack.unpackb(v)
        except Exception as e:
            if self.debug:
                print "Failed to unpack object: ", e
            return list()

        return self.__simplify(obj)

    def device_filtered_dot11_probe_summary(self, pcre, fields = None):
        """
        device_filtered_dot11_probe_summary() -> device summary list, filtered by
        dot11 ssid

        Return summary of all devices that match filter terms
        """

        cmd = {
                "essid": pcre
                }

        if fields != None:
            cmd["fields"] = fields

        (r, v) = self.post_msgpack_url("phy/phy80211/probe_regex.cmd", cmd)
        if not r:
            print "Could not fetch summary"

            if self.debug:
                print "Error: ", v

            return list()

        try:
            obj = msgpack.unpackb(v)
        except Exception as e:
            if self.debug:
                print "Failed to unpack object: ", e
            return list()

        return self.__simplify(obj)

    def device_dot11_clients(self, device):
        """
        device_dot11_clients() -> device list of clients associated to a 
        given dot11 device

        Returns full device records of all client devices
        """

        devices = list()

        if not "dot11.device" in device:
            if self.debug:
                print "Not a dot11 device"

            return list()

        d11device = device["dot11.device"]

        if not "dot11.device.associated_client_map" in d11device:
            if self.debug:
                print "Missing associated client map"

            return list()

        for m in d11device["dot11.device.associated_client_map"]:
            if self.debug:
                print "Client {}".format(m)

            d = self.device(d11device["dot11.device.associated_client_map"][m])

            if d != None:
                devices.append(d)

        return devices

if __name__ == "__main__":
    x = KismetConnector()
    print x.system_status()
    print x.device_summary()
    y = 'Example'
    t = 'Example 2'
    print x.device_filtered_dot11_summary([y, t])
    #print x.old_sources()
