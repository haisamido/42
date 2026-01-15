#!/usr/bin/env python3
"""
IPC Client for 42 Spacecraft Simulation
Connects to 42's TX server and receives telemetry data.
Sends "Ack" response after each message as required by WriteToSocket.
"""
import socket

HOST = 'localhost'
PORT = 10001

def main():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.connect((HOST, PORT))
        print(f"Connected to {HOST}:{PORT}")
        print("Waiting for data from 42 simulation...")
        print("Press Ctrl+C to disconnect\n")

        msg_count = 0
        while True:
            try:
                # Blocking recv - wait for data from server
                data = s.recv(8192)
                if not data:
                    print("\nServer closed connection")
                    break

                msg_count += 1
                # Decode and print received data
                text = data.decode('utf-8', errors='replace')
                print(f"--- Message {msg_count} ---")
                print(text)

                # Send Ack response (required by WriteToSocket)
                s.sendall(b'Ack\x00')

            except KeyboardInterrupt:
                print(f"\nDisconnected after {msg_count} messages")
                break
            except Exception as e:
                print(f"Error: {e}")
                break

if __name__ == "__main__":
    main()
