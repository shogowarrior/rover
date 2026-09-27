#ifndef CONFIG_H
#define CONFIG_H

// Template for src/config.h, which is gitignored because it holds the
// credentials for one specific device.
//
//   cp src/config.example.h src/config.h
//
// then fill in your network. CI copies this file verbatim so the firmware can
// be compiled without any real credentials. Only src/Network.cpp includes it.

#define WIFI_SSID "your-ssid"
#define WIFI_PASSWORD "your-password"
#define WIFI_HOSTNAME "rover"  // also the OTA/mDNS name: rover.local

// When true the rover claims the static IP configured in src/Network.cpp,
// which must also match `upload_port` for the car_ota environment in
// platformio.ini. Set false to take whatever DHCP hands out -- in which case
// OTA flashing needs the address updated in both places (or use rover.local).
#define WIFI_IS_STATIC_IP true

// Optional: require a password for OTA flashing. Without one, anything on the
// network can flash the rover. Define ONE of these; the hash keeps the
// plaintext out of the firmware image (`printf '%s' 'secret' | md5`). Then add
// `upload_flags = --auth=secret` to [env:car_ota] in platformio.ini.
// #define OTA_PASSWORD_HASH "5ebe2294ecd0e0f08eab7690d2a6ee69"
// #define OTA_PASSWORD "secret"

#endif  // CONFIG_H
