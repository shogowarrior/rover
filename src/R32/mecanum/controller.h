#ifndef CONTROLLER_H
#define CONTROLLER_H

#include <Ps3Controller.h>

void onConnect();
void controlMecanum();
void attachController();

int calculateSpeed(int x, int y, int speed);
float calculateAngle(int x, int y);

#endif