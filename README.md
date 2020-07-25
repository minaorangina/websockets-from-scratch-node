# Websockets from scratch

A websocket server using only the Node standard library -  no socket.io or any websocket SaaS products. 
It implements the main tenets of the Websocket Protocol [as described in RFC 6455](https://tools.ietf.org/html/rfc6455).

It currently publishes random book titles to the client on an interval, but of course this could be replaced with anything.

## Capabilities
- Upgrading a TCP connection to websocket
- Parsing incoming websocket request frames 
- Returning websocket response frames
- Supports payloads of up to 65,535 bytes.

## Limitations
- Only supports json for now
- Payloads larger than 65,535 bytes not supported
- Protocol-level extentions under the `Sec-WebSocket-Extensions` header not supported

This is just for fun - using this in production would be thoroughly unwise.