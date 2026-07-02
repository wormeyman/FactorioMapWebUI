const utf8 = new TextEncoder();

/** Sequential little-endian writer; the inverse of BinaryReader. */
export class BinaryWriter {
  private readonly bytes: number[] = [];
  private readonly scratch = new DataView(new ArrayBuffer(8));

  get length(): number {
    return this.bytes.length;
  }

  private pushScratch(n: number): void {
    for (let i = 0; i < n; i++) {
      this.bytes.push(this.scratch.getUint8(i));
    }
  }

  writeUint8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  writeUint16(value: number): void {
    this.scratch.setUint16(0, value, true);
    this.pushScratch(2);
  }

  writeUint32(value: number): void {
    this.scratch.setUint32(0, value >>> 0, true);
    this.pushScratch(4);
  }

  writeFloat32(value: number): void {
    this.scratch.setFloat32(0, value, true);
    this.pushScratch(4);
  }

  writeFloat64(value: number): void {
    this.scratch.setFloat64(0, value, true);
    this.pushScratch(8);
  }

  writeBytes(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.bytes.push(byte);
    }
  }

  writeString(value: string): void {
    const encoded = utf8.encode(value);
    this.writeUint8(encoded.length);
    this.writeBytes(encoded);
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}
