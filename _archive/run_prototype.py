import http.server
import socketserver
import os
import sys

PORT = 8000
DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prototype")

class PrototypeHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

if __name__ == "__main__":
    print(f"============================================================")
    print(f"Starting POS Surcharge E2E Prototype Server...")
    print(f"Serving files from: {DIRECTORY}")
    print(f"Open your browser and navigate to: http://localhost:{PORT}")
    print(f"Press Ctrl+C to stop the server.")
    print(f"============================================================")
    
    if not os.path.exists(DIRECTORY):
        os.makedirs(DIRECTORY)
        
    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(("", PORT), PrototypeHTTPRequestHandler) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down prototype server...")
        sys.exit(0)
    except Exception as e:
        print(f"Error launching server: {e}")
        sys.exit(1)
