// Create JoyStick object into the DIV 'joy1Div'
//var Joy1 = new JoyStick('joy1Div');

var joy1IinputPosX = document.getElementById("joy1PosizioneX");
var joy1InputPosY = document.getElementById("joy1PosizioneY");
var joy1Direzione = document.getElementById("joy1Direzione");
var joy1X = document.getElementById("joy1X");
var joy1Y = document.getElementById("joy1Y");
/*
      setInterval(function(){ joy1IinputPosX.value=Joy1.GetPosX(); }, 50);
      setInterval(function(){ joy1InputPosY.value=Joy1.GetPosY(); }, 50);
      setInterval(function(){ joy1Direzione.value=Joy1.GetDir(); }, 50);
      setInterval(function(){ joy1X.value=Joy1.GetX(); }, 50);
      setInterval(function(){ joy1Y.value=Joy1.GetY(); }, 50);
      */
// Create JoyStick object into the DIV 'joy1Div'
var Joy1 = new JoyStick("joy1Div", {}, function (stickData) {
  joy1IinputPosX.value = stickData.xPosition;
  joy1InputPosY.value = stickData.yPosition;
  joy1Direzione.value = stickData.cardinalDirection;
  joy1X.value = stickData.x;
  joy1Y.value = stickData.y;
});
