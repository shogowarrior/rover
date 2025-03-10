#ifndef CONTROLLER_H
#define CONTROLLER_H

#pragma once
#include <ArduinoJson.h>
#include <Ps3Controller.h>

class Controller {
    
  public:
  int calculateSpeed(int x, int y, int speed);
  float calculateAngle(int x, int y);
  
  void attach();
  void getLeftJoyStick(JsonArray array);
  void getRightJoyStick(JsonArray array);
  void getTriggers(JsonArray array);
};

#endif