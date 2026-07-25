#ifndef CONTROLLER_H
#define CONTROLLER_H

#include <Ps3Controller.h>

#include "MoveCodes.h"

class Controller {
 public:
  struct Command {
    MoveCode move;
    int speed;
  };

  // Pair with the gamepad and start delivering commands to the rover.
  void attach();

  // Translate the current gamepad state into a single command. Returns
  // {STOP, 0} when nothing is deflected past the deadzone.
  Command readGamepad() const;

 private:
  Command fromLeftStick() const;
  Command fromTriggers() const;
};

#endif
