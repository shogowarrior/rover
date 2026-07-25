#ifndef CONFIG_H
#define CONFIG_H

// Template for src/config.h, which is gitignored because it holds the
// credentials for one specific device.
//
//   cp src/config.example.h src/config.h
//
// then fill in your network. CI copies this file verbatim so the firmware can
// be compiled without any real credentials.

#define WIFI_SSID "your-ssid"
#define WIFI_PASSWORD "your-password"
#define WIFI_HOSTNAME "rover"

// When true the rover claims the static IP configured in src/Service.cpp,
// which must also match `upload_port` for the car_ota environment in
// platformio.ini. Set false to take whatever DHCP hands out -- in which case
// OTA flashing needs the address updated in both places.
#define WIFI_IS_STATIC_IP true

#endif  // CONFIG_H
