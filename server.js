const http = require("http");
const crypto = require("crypto");
const static = require("node-static");

const file = new static.Server("./public");
const server = http.createServer((req, res) => {
  req.addListener("end", () => file.serve(req, res)).resume();
});

server.on("upgrade", (req, socket) => {
  if (req.headers.upgrade !== "websocket") {
    socket.end("HTTP 1.1 400 Bad Request");
    return;
  }

  const acceptKey = req.headers["sec-websocket-key"];
  const hash = acceptHash(acceptKey);

  const responseHeaders = [
    "HTTP/1.1 101 New Protocol Tings",
    "Upgrade: WebSocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${hash}`,
  ];

  const protocol = req.headers["sec-websocket-protocol"];
  const protocols = protocol ? protocol.split(",").map((s) => s.trim()) : [];
  if (protocols.includes("json")) {
    responseHeaders.push("Sec-WebSocket-Protocol: json");
  }
  // handle if no subprotocol is found

  socket.write(responseHeaders.join("\r\n") + "\r\n\r\n");

  socket.on("data", (buf) => {
    const msgFromClient = parseMessage(buf);

    if (msgFromClient) {
      console.log(msgFromClient);
      const response = constructReply({ message: "Hello from the server!" });

      console.log("Sending back: ", response.toString("hex"));
      socket.write(response);
    } else if (msgFromClient === null) {
      console.log("WebSocket connection closed by the client.");
    }
  });
});

const port = 3210;
server.listen(port, () =>
  console.log(`Server running at http://localhost:${port}`)
);

function constructReply(data) {
  const json = JSON.stringify(data);
  const jsonLengthBytes = Buffer.byteLength(json);
  let bytesToAlloc = 2;
  let isExtendedPayload = false;
  let payloadLengthPart1, payloadLengthPart2;

  // If the payload size is 0 - 125 bytes, payloadLengthPart1 holds the payload size
  // and payloadLengthPart2 is unused
  // We also add the length of data to bytesToAlloc
  if (jsonLengthBytes < 126) {
    payloadLengthPart1 = jsonLengthBytes;
    bytesToAlloc += jsonLengthBytes;
  }
  // If the payload size is 126 - 65,535 bytes, payloadLengthPart1 holds the value 126
  // and payloadLengthPart2 holds the payload size
  // We also increase the number of bytes to allocate by 2 + length of data in bytes
  if (jsonLengthBytes === 126) {
    payloadLengthPart1 = 126;
    payloadLengthPart2 = jsonLengthBytes;
    bytesToAlloc += 2 + jsonLengthBytes;
    isExtendedPayload = true;
  }
  // Larger payload sizes are not supported, but if they were,
  // payloadLengthPart1 would hold the value 127 and payloadLengthPart2 would hold the payload size (max 2^64 bytes)

  let payloadOffsetBytes = 2;
  const buf = Buffer.alloc(bytesToAlloc);

  // indicates this is a text frame and the final frame
  // as specified in RFC 6455 5.2 Base Framing Protocol
  const firstByte = 0b10000001;
  buf.writeUInt8(firstByte, 0);
  buf.writeUInt8(payloadLengthPart1, 1);

  if (isExtendedPayload) {
    buf.writeUInt16BE(payloadLengthPart2, 2);
    payloadOffsetBytes += 2;
  }

  buf.write(json, payloadOffsetBytes);
  return buf;
}

function parseMessage(buf) {
  const firstByte = buf.readUInt8(0);
  const isFinalFrame = mostSignificantBitIsOn(firstByte);
  const [reserved1, reserved2, reserved3] = [
    Boolean((firstByte >>> 6) & 0x1),
    Boolean((firstByte >>> 5) & 0x1),
    Boolean((firstByte >>> 4) & 0x1),
  ];

  const opCode = firstByte & 0xf;
  // 0x8 is the op code for connection termination
  if (opCode === 0x8) {
    return null;
  }
  // 0x1 is the op code for text frames
  if (opCode !== 0x1) {
    return;
  }
  const secondByte = buf.readUInt8(1);
  const isMasked = Boolean((secondByte >>> 7) & 0x1);

  // Locate the payload length. Assumed to be 2 bytes in, unless we discover otherwise
  let payloadOffsetBytes = 2;
  let payloadLengthBytes = secondByte & 0x7f;

  if (payloadLengthBytes > 125) {
    // denotes 16-bit payload length
    if (payloadLengthBytes === 126) {
      payloadLengthBytes = buf.readUInt16BE(payloadOffsetBytes);
      payloadOffsetBytes += 2;
    } else {
      // denotes mega-long 64-bit payload length
      throw new Error("Mega-long websocket frames not currently supported");
    }
  }

  let maskingKey;
  if (isMasked) {
    maskingKey = buf.readUInt32BE(payloadOffsetBytes);
    payloadOffsetBytes += 4;
  }

  const data = Buffer.alloc(payloadLengthBytes);
  if (isMasked) {
    for (
      let i = 0, maskByteIdx = 0;
      i < payloadLengthBytes;
      ++i, maskByteIdx = i % 4
    ) {
      const shift = getMaskShiftBits(maskByteIdx);
      const mask = (shift === 0 ? maskingKey : maskingKey >>> shift) & 0xff;

      const sourceByte = buf.readUInt8(payloadOffsetBytes);
      payloadOffsetBytes++;

      const unmasked = mask ^ sourceByte;
      data.writeUInt8(unmasked, i);
    }
  } else {
    buf.copy(data, 0, payloadOffsetBytes);
    payloadOffsetBytes++;
  }

  const json = data.toString("utf8");
  const parsed = JSON.parse(json);
  return parsed;
}

function acceptHash(acceptKey) {
  const guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
  return crypto
    .createHash("sha1")
    .update(acceptKey + guid, "binary")
    .digest("base64");
}

function mostSignificantBitIsOn(byte) {
  return Boolean((byte >>> 7) & 0x1);
}

function getMaskShiftBits(maskByteIdx) {
  // To get maskOctet[0], shift the mask by 3 bytes
  // To get maskOctet[1], shift the mask by 2 bytes
  // To get maskOctet[2], shift the mask by 1 byte
  // To get maskOcted[3], no need to shift (shifting zero by 3)
  // << 3 equivalent to multiplying by 8 to get the number of bits
  return (3 - maskByteIdx) << 3;
}
