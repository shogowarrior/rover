// #include <AsyncJson.h>
// #include <ESPAsyncWebServer.h>

// AsyncWebServer server(80);

// void sendResponse(AsyncWebServerRequest *request) {
//   // Create JSON object for the response
//   StaticJsonDocument<200> responseJson;
//   responseJson["status"] = 200;
//   responseJson["message"] = "Received JSON data successfully";

//   // Serialize JSON document to a string
//   String responseStr;
//   serializeJson(responseJson, responseStr);

//   // Send response with appropriate content type
//   request->send(200, "application/json", responseStr);
// }

// void handleJsonRequest(AsyncWebServerRequest *request, JsonVariant &json) {
//   JsonObject jsonObj = json.as<JsonObject>();

//   StaticJsonDocument<1024> jsonDoc;
//   jsonDoc.set(json.as<JsonObject>());

//   // Send Response to HTTP
//   sendResponse(request);

//   serializeJson(jsonDoc, espSerial);
//   serializeJsonPretty(jsonDoc, usbSerial);

//   // Short delay to ensure the command is sent
//   delay(100);
// }

// void startWebServer() {
//   // Create and add the JSON handler
//   AsyncCallbackJsonWebHandler *handler = new AsyncCallbackJsonWebHandler("/operate", [](AsyncWebServerRequest *request, JsonVariant &json) {
//     handleJsonRequest(request, json);
//   });
//   server.addHandler(handler);
//   server.begin();
//   Serial.println("WS started");
// }