// #include "WiFiUtils.h"

// #include <SPI.h>
// #include <WiFi.h>
// // #include <ESPmDNS.h>  // Include the mDNS library

// bool isStaticIp;

// // Static IP configuration
// IPAddress local_IP(192, 168, 1, 184);
// IPAddress gateway(192, 168, 1, 1);
// IPAddress subnet(255, 255, 255, 0);
// IPAddress primaryDNS(8, 8, 8, 8);
// IPAddress secondaryDNS(8, 8, 4, 4);

// const char* ssid = "Arjun";
// const char* password = "Laurie123";
// const char* hostname = "mecanumrobot";

// void setStaticIP() {
//   if (isStaticIp) {
//     if (!WiFi.config(local_IP, gateway, subnet, primaryDNS, secondaryDNS)) {
//       Serial.println("STA Failed to configure");
//     }
//   }
// }

// void setHostName() {
//   if (!WiFi.setHostname(hostname)) {
//     Serial.println("Failed to set hostname");
//   }
// }

// void printWiFiStatus() {
//   Serial.println("IP address: ");
//   Serial.println(WiFi.localIP());
// }

// void connectWiFi() {
//   Serial.print("Connecting to ");
//   Serial.println(ssid);
//   setHostName();
//   setStaticIP();
//   WiFi.begin(ssid, password);
//   while (WiFi.status() != WL_CONNECTED) {
//     delay(500);
//     Serial.print(".");
//   }

//   Serial.println("");
//   Serial.println("WiFi connected.");
//   printWiFiStatus();
// }
