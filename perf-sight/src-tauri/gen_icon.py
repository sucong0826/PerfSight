import struct

def create_ico():
    # Valid 1x1 transparent ICO
    # Header: 6 bytes
    # Entry: 16 bytes
    # BMP Header: 40 bytes
    # Pixel (XOR): 4 bytes
    # Mask (AND): 4 bytes
    # Total: 70 bytes
    
    data = bytes.fromhex(
        "000001000100"      # Header: Reserved=0, Type=1(Icon), Count=1
        "0101000001002000"  # Entry: W=1, H=1, Colors=0, Res=0, Planes=1, BPP=32
        "30000000"          # Size of data = 48 bytes
        "16000000"          # Offset of data = 22
        
        # BITMAPINFOHEADER
        "28000000"          # Size=40
        "01000000"          # Width=1
        "02000000"          # Height=2 (1 XOR + 1 AND)
        "0100"              # Planes=1
        "2000"              # BPP=32
        "00000000"          # Compression=0
        "00000000"          # ImageSize=0
        "00000000"          # Xppm
        "00000000"          # Yppm
        "00000000"          # ColorsUsed
        "00000000"          # ColorsImportant
        
        # XOR Map (1 pixel, 32bpp BGRA)
        "00000000"          # Transparent black
        
        # AND Map (1 bit per pixel, 32-bit aligned scanlines)
        # 1 pixel needs 1 bit. Padded to 32 bits = 4 bytes.
        "FFFFFFFF"          # All 1s = Transparent (Mask: 1=Transp, 0=Opaque)
    )
    
    try:
        with open('icons/icon.ico', 'wb') as f:
            f.write(data)
        print("Successfully created icons/icon.ico")
    except Exception as e:
        print(f"Error creating icon: {e}")

if __name__ == "__main__":
    create_ico()

