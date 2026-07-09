const utf8 = new TextDecoder();

/** Sequential little-endian reader over a Uint8Array (handles subarray views). */
export class BinaryReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get position(): number {
    return this.offset;
  }

  get length(): number {
    return this.bytes.length;
  }

  private advance(n: number): number {
    if (this.offset + n > this.bytes.length) {
      throw new RangeError(
        `read of ${n} bytes at offset ${this.offset} exceeds payload length ${this.bytes.length}`,
      );
    }
    const at = this.offset;
    this.offset += n;
    return at;
  }

  readUint8(): number {
    return this.view.getUint8(this.advance(1));
  }

  readUint16(): number {
    return this.view.getUint16(this.advance(2), true);
  }

  readUint32(): number {
    return this.view.getUint32(this.advance(4), true);
  }

  readInt32(): number {
    return this.view.getInt32(this.advance(4), true);
  }

  readFloat32(): number {
    return this.view.getFloat32(this.advance(4), true);
  }

  readFloat64(): number {
    return this.view.getFloat64(this.advance(8), true);
  }

  readBytes(n: number): Uint8Array {
    const at = this.advance(n);
    return this.bytes.subarray(at, at + n);
  }

  readString(): string {
    const length = this.readUint8();
    return utf8.decode(this.readBytes(length));
  }

  remaining(): Uint8Array {
    return this.bytes.subarray(this.offset);
  }
}
