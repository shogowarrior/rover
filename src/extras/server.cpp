// #include <WiFi.h>


// // Replace with your network credentials
// const char* ssid = "your_SSID";
// const char* password = "your_PASSWORD";



// void setup() {
//   webSocket.begin();
//   webSocket.onEvent(webSocketEvent);
// }

// void loop() {
//   // Handle WebSocket communication
//   webSocket.loop();

//   // Example: Send sensor data periodically
//   static unsigned long lastTime = 0;
//   unsigned long now = millis();
//   if (now - lastTime > 2000) { // Every 2 seconds
//     lastTime = now;
//     String sensorData = "Temperature: " + String(random(20, 30)) + "C"; // Example sensor data
//     webSocket.broadcastTXT(sensorData);
//   }
// }
