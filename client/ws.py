import asyncio
import websockets

async def listen():
    uri = "ws://192.168.0.115:81"

    async with websockets.connect(uri) as websocket:
        print("Connected to ESP32 WebSocket server")

        while True:
            try:
                message = await websocket.recv()
                print(f"Received: {message}")

                # Optionally, you can parse JSON messages if the ESP32 sends JSON data
                # data = json.loads(message)
                # print(f"Distance: {data['distance']} cm")

            except websockets.ConnectionClosed:
                print("Connection closed")
                break
print("hello")
# Run the event loop to listen to the WebSocket server
asyncio.get_event_loop().run_until_complete(listen())

print("hello")