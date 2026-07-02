/* PNG generator, copyright 2017-2026 Aerik Sylvan
    requires PAKO library for DEFLATE function
*/
// Initializing PNGJS global object (if still undefined)
(function () {
    if (!((typeof window !== 'undefined' ? window : this)["PNGJS"])) {
        "use strict";
        const PNGJS = {};
        (typeof window !== 'undefined' ? window : this)["PNGJS"] = PNGJS;

        //enum
        PNGJS.ColorType = {
            Grey: 0,
            RGB24: 2,
            Palette: 3,
            RGBA32: 6
        };

        /* helper functions */
        function write(buffer, offset, byteAry) {
            //for (let i = 0; i < byteAry.length; i++) {
            //    buffer[offset + i] = byteAry[i];
            //}
            //much faster
            buffer.set(byteAry, offset);
            return byteAry.length;
            return byteAry.length;
        }

        const swap32 = function (val) {
            return ((val & 0xFF) << 24)
                | ((val & 0xFF00) << 8)
                | ((val >> 8) & 0xFF00)
                | ((val >> 24) & 0xFF);
        }
        const swap16 = function (val) {
            return ((val & 0xFF) << 8)
                | ((val >> 8) & 0xFF);
        }
        const intBuf = new Uint32Array(1);
        //const shortBuf = new Uint16Array(1);
        const bufSize4 = new Uint8Array(intBuf.buffer);
        //const bufSize2 = new Uint8Array(shortBuf.buffer);
        const intToBytes = function (someInt) {
            intBuf[0] = swap32(someInt);
            return bufSize4.slice();
        }
        //const shortToBytes = function(someShort) {
        //    shortBuf[0] = swap16(someShort);
        //    return bufSize2;
        //}


        //from https://stackoverflow.com/questions/18638900/javascript-crc32
        const fallbackCrc32 = (function () {
            var table = new Uint32Array(256);
            // Pre-generate crc32 polynomial lookup table
            for (var i = 256; i--;) {
                var tmp = i;
                for (var k = 8; k--;) {
                    tmp = tmp & 1 ? 3988292384 ^ tmp >>> 1 : tmp >>> 1;
                }
                table[i] = tmp;
            }
            // crc32b
            return function (data) {
                var crc = -1; // Begin with all bits set ( 0xffffffff )
                for (var i = 0, l = data.length; i < l; i++) {
                    crc = crc >>> 8 ^ table[crc & 255 ^ data[i]];
                }
                return (crc ^ -1) >>> 0; // Apply binary NOT
            };
        })();

        // Fallback Adler-32 implementation in pure JavaScript
        // Returns a number (the 32-bit Adler-32 checksum)

        const fallbackAdler32 = function (data) {
            // data: Uint8Array, Buffer, or array of numbers (0–255)
            const MOD_ADLER = 65521;
            let a = 1, b = 0;

            for (let i = 0; i < data.length; ++i) {
                a = (a + data[i]) % MOD_ADLER;
                b = (b + a) % MOD_ADLER;
            }

            // Combine into a 32-bit number
            return ((b << 16) | a) >>> 0;
        }

        const hashFuncs = { adler32: fallbackAdler32, crc32: fallbackCrc32 };

        if (typeof hashwasm !== "undefined" && typeof hashwasm.createCRC32 === "function") {
            (async function () {
                try {
                    const hasher = await hashwasm.createCRC32();
                    hashFuncs.crc32 = (data) => {
                        hasher.init();
                        hasher.update(data);
                        return parseInt(hasher.digest(), 16);
                    };
                } catch (e) {
                    console.warn("Could not initialize WASM CRC32:", e);
                }
            })();
        }

        if (typeof hashwasm !== "undefined" && typeof hashwasm.createAdler32 === "function") {
            (async function () {
                try {
                    const hasher = await hashwasm.createAdler32();
                    hashFuncs.adler32 = (data) => {
                        hasher.init();
                        hasher.update(data);
                        return parseInt(hasher.digest(), 16);
                    };
                } catch (e) {
                    console.warn("Could not initialize WASM Adler32:", e);
                }
            })();
        }



        /**
         * Fast zlib-wrapped DEFLATE "stored" (uncompressed) encoder for PNG IDAT chunk.
         * @param {Uint8Array} scanlineData - The scanline data: each scanline must already include its filter byte.
         * @param {number} height - Image height in pixels.
         * @returns {Uint8Array} Buffer for IDAT chunk data (zlib-wrapped, ready for PNG).
         */
        const writeIdatRaw = function (scanlineData, height) {
            const MAX_BLOCK = 0xFFFF;
            const rowLen = scanlineData.length / height; // scanline must be width*bytesPerPixel+1
            const nRows = height;
            const totalDataLen = scanlineData.length;
            const rowsPerBlock = Math.floor(MAX_BLOCK / rowLen) || 1;
            const nBlocks = Math.ceil(nRows / rowsPerBlock);
            const idatLen = 2 + nBlocks * 5 + totalDataLen + 4;
            const idatRaw = new Uint8Array(idatLen);

            // Zlib header for "no compression" (CMF=0x78, FLG=0x01)
            idatRaw[0] = 0x78;
            idatRaw[1] = 0x01;

            let dst = 2;
            let src = 0;
            let a = 1, b = 0; // Adler-32 checksum

            while (src < scanlineData.length) {
                const isFinal = (src + MAX_BLOCK >= scanlineData.length) ? 1 : 0;
                const blockLen = Math.min(MAX_BLOCK, scanlineData.length - src);
                const nlen = (~blockLen) & 0xFFFF;

                idatRaw[dst++] = isFinal;
                idatRaw[dst++] = blockLen & 0xFF;
                idatRaw[dst++] = (blockLen >> 8) & 0xFF;
                idatRaw[dst++] = nlen & 0xFF;
                idatRaw[dst++] = (nlen >> 8) & 0xFF;

                // Copy the whole block in one go
                idatRaw.set(scanlineData.subarray(src, src + blockLen), dst);

                // Adler-32 update for the block
                //for (let i = 0; i < blockLen; ++i) {
                //    a = (a + scanlineData[src + i]) % 65521;
                //    b = (b + a) % 65521;
                //}

                dst += blockLen;
                src += blockLen;
            }

            // Adler-32 checksum (big-endian)
            //const adler = ((b << 16) | a) >>> 0;
            const adler = hashFuncs.adler32(scanlineData);
            idatRaw[dst++] = (adler >> 24) & 0xFF;
            idatRaw[dst++] = (adler >> 16) & 0xFF;
            idatRaw[dst++] = (adler >> 8) & 0xFF;
            idatRaw[dst++] = adler & 0xFF;

            return idatRaw.subarray(0, dst);
        }

        /**
        * private PNG constructor
        *
        * @constructor
        */
        function Png(width, height, colorType, pxData) {
            if (![0, 2, 3, 6].includes(colorType)) {
                throw "Color type not supported";
            }
            var bytesPerPixel = 1;
            if (colorType == 4) bytesPerPixel = 2;
            if (colorType == 2) bytesPerPixel = 3;
            if (colorType == 6) bytesPerPixel = 4;
            var scanWidth = width * bytesPerPixel + 1;//RGB or RGBA, plus filter byte
            var numElems = height * scanWidth;
            var ownsPxData = false;
            if (pxData) {
                if (pxData.length != numElems) {
                    throw "Pixel Data does not match input dimensions (plus one filter byte per line)";
                }
            } else {
                pxData = new Uint8Array(numElems);
                ownsPxData = true;
            }
            this.getHeight = function () {
                return height;
            }
            this.getWidth = function () {
                return width;
            }
            const IHDRdataLen = 33;
            const IHDRdata = new Uint8Array(IHDRdataLen);
            //each is an array of byte values
            const magicNumberHdr = [137, 80, 78, 71, 13, 10, 26, 10];
            const IHDRlen = intToBytes(13);
            const IHDR = [73, 72, 68, 82];
            const widthBytes = intToBytes(width);
            const heightBytes = intToBytes(height);
            const bitDepth = [8];
            const compMethod = [0];
            const filter = [0];
            const interlace = [0];
            write(IHDRdata, 0, magicNumberHdr);
            write(IHDRdata, 8, IHDRlen);
            write(IHDRdata, 12, IHDR);
            write(IHDRdata, 16, widthBytes);
            write(IHDRdata, 20, heightBytes);
            write(IHDRdata, 24, bitDepth);
            write(IHDRdata, 25, [colorType]);
            write(IHDRdata, 26, compMethod);
            write(IHDRdata, 27, filter);
            write(IHDRdata, 28, interlace);
            const IHDRchunk = IHDRdata.slice(12, 29);
            const IHDRcrc = intToBytes(hashFuncs.crc32(IHDRchunk));
            write(IHDRdata, 29, IHDRcrc);

            //defaults to greyscale
            this.setPixel = function (x, y, pxVal) {
                var yOffset = y * scanWidth;
                pxData[yOffset + x + 1] = pxVal;
            }
            if (colorType === PNGJS.ColorType.Palette) {
                this.palette = new Uint8Array(256 * 3); // Support up to 256 colors
                this.numColors = 0;

                this.addColor = function (r, g, b) {
                    if (this.numColors >= 256) {
                        throw "Palette full: cannot add more colors.";
                    }
                    var offset = this.numColors * 3;
                    this.palette[offset] = r;
                    this.palette[offset + 1] = g;
                    this.palette[offset + 2] = b;
                    return this.numColors++;
                };
            }
            if (colorType == 4) { //?
                this.setPixel = function (x, y, pxVal, alpha) {
                    var yOffset = y * scanWidth;
                    var xOffset = x * bytesPerPixel;
                    pxData[yOffset + xOffset + 1] = pxVal;
                    pxData[yOffset + xOffset + 2] = alpha;
                }
            }
            if (colorType == 2 || colorType == 6) {
                const usingAlpha = colorType == 6 ? true : false;
                this.setPixel = function (x, y, r, g, b, a) { //pxVal = ARGB integer
                    var yOffset = y * scanWidth;
                    var xOffset = x * bytesPerPixel;
                    if (g === void (0)) {
                        intBuf[0] = r;
                        r = bufSize4[0];
                        g = bufSize4[1];
                        b = bufSize4[2];
                        a = bufSize4[3];
                    }
                    pxData[yOffset + xOffset + 1] = r;
                    pxData[yOffset + xOffset + 2] = g;
                    pxData[yOffset + xOffset + 3] = b;
                    if (usingAlpha) pxData[yOffset + xOffset + 4] = a;
                }
            }

            this.getBytes = function (compression) {
                var compLevel = compression || 0;
                var compStart = new Date();
                let oldData = pxData;
                let newData = oldData;//for applying top or left filter
                //deflate pixeldata
                if (compression > 0) {
                    newData = oldData.slice();// new Uint8Array(oldData.length);
                    //top - based on a few tests, this results in smaller compressed png
                    if (compression > 0 && compression < 10) {
                        let h = this.getHeight();
                        let w = this.getWidth();
                        let sw = (w * bytesPerPixel) + 1;//scanWidth in bytes (not pixels)
                        for (let y = 1; y < h; y++) {
                            let yOffset = y * sw;
                            let lastYoffset = yOffset - sw;
                            newData[yOffset] = 2;
                            for (let x = 1; x < sw; x++) {
                                let xyOff = yOffset + x;
                                let curVal = oldData[xyOff];
                                let lastVal = oldData[lastYoffset + x];
                                newData[xyOff] = ((curVal - lastVal) % 256) & 255;
                            }
                        }
                        //compression = 1;
                    }
                    //apply "left" filter
                    if (compression == 10) {
                        let h = this.getHeight();
                        let w = this.getWidth();
                        let sw = (w * bytesPerPixel) + 1;//scanWidth in bytes (not pixels)
                        for (let y = 0; y < h; y++) {
                            let yOffset = y * sw;
                            newData[yOffset] = 1;
                            for (let x = 2; x < sw; x++) {
                                let xyOff = yOffset + x;
                                let curVal = oldData[xyOff];
                                let lOff = x - bytesPerPixel;
                                if (lOff > 0) {
                                    let lastVal = oldData[yOffset + lOff];
                                    newData[xyOff] = ((curVal - lastVal) % 256) & 255;
                                }
                            }
                        }
                        compression = 9;
                    }
                }
                var defStart = new Date();
                console.debug("Compress filter time " + (defStart - compStart) + "ms");
                var defBytes;
                if (compression == 0) {
                    // No compression, use stored block
                    defBytes = writeIdatRaw(newData, this.getHeight());
                } else {
                    defBytes = pako["deflate"](newData, { level: compLevel });// , { level: 0 } no compression, 1 is fast
                }
                console.debug("Compress deflate time " + ((new Date()) - defStart) + "ms, ratio " + (defBytes.length / newData.length));
                if (newData !== pxData) {
                    newData.length = 0;
                    newData = null;
                }
                var IDATlen = intToBytes(defBytes.length);
                var IDAT = [73, 68, 65, 84];

                var IENDlen = intToBytes(0);
                var IEND = new Uint8Array([73, 69, 78, 68]);
                var IENDcrc = intToBytes(hashFuncs.crc32(IEND));

                var plteDataLen = 0;
                var plteData = null;

                // Include PLTE chunk if using the palette color type
                if (colorType === PNGJS.ColorType.Palette) {
                    const plteLen = intToBytes(this.numColors * 3);
                    const plteHeader = [80, 76, 84, 69]; // 'PLTE'
                    plteData = new Uint8Array(this.numColors * 3 + 12);
                    write(plteData, 0, plteLen);
                    write(plteData, 4, plteHeader);
                    write(plteData, 8, this.palette.slice(0, this.numColors * 3));
                    const plteCRC = intToBytes(hashFuncs.crc32(plteData.slice(4, plteData.length - 4)));
                    write(plteData, plteData.length - 4, plteCRC);
                    plteDataLen = plteData.length;
                }

                var trnsDataLen = 0;
                var trnsData = null;

                // Include tRNS chunk if transparency is defined
                if (colorType === PNGJS.ColorType.Palette && this.transparency) {
                    const trnsLen = intToBytes(this.numColors);
                    const trnsHeader = [116, 82, 78, 83]; // 'tRNS'
                    trnsData = new Uint8Array(this.numColors + 12);
                    write(trnsData, 0, trnsLen);
                    write(trnsData, 4, trnsHeader);
                    write(trnsData, 8, this.transparency.slice(0, this.numColors));
                    const trnsCRC = intToBytes(hashFuncs.crc32(trnsData.slice(4, trnsData.length - 4)));
                    write(trnsData, trnsData.length - 4, trnsCRC);
                    trnsDataLen = trnsData.length;
                }

                var dataLen = IHDRdata.length + plteDataLen + trnsDataLen + IDATlen.length + IDAT.length + defBytes.length + 4 + IENDlen.length + IEND.length + IENDcrc.length;
                var data = new Uint8Array(dataLen);

                write(data, 0, IHDRdata);
                if (plteData) write(data, IHDRdata.length, plteData);
                if (trnsData) write(data, IHDRdata.length + plteDataLen, trnsData);
                var idatOffset = IHDRdata.length + plteDataLen + trnsDataLen;
                var curOffset = idatOffset;
                curOffset += write(data, curOffset, IDATlen);
                curOffset += write(data, curOffset, IDAT);
                curOffset += write(data, curOffset, defBytes);

                // Calculate and write CRC for IDAT
                var idatData = new Uint8Array(data.buffer.slice(idatOffset + IDATlen.length, data.length - 16));
                var idatCRC = intToBytes(hashFuncs.crc32(idatData));
                write(data, data.length - 16, idatCRC);
                write(data, data.length - 12, IENDlen);
                write(data, data.length - 8, IEND);
                write(data, data.length - 4, IENDcrc);

                return data;
            }

            this.close = function () {
                if (ownsPxData) pxData.length = 0;
            }
        }

        PNGJS.Create = function (width, height, colorType, pxData) {
            return new Png(width, height, colorType, pxData);
        }

        /**
         * Creates a PNG from raw pixel data.
         * @param {Number} width - The width of the PNG.
         * @param {Number} height - The height of the PNG.
         * @param {PNGJS.colorType} colorType - The color type of the PNG (0, 2, 3, or 6).
         * @param {ArrayBufferView} pixels - The pixel data, which should be a flat array of pixel values.
         * @return {Png} A new Png object containing the raw pixel data. 
         * @throws {Error} If the color type is not supported or if the pixel data does not match the expected dimensions.
         * */
        PNGJS.CreateRaw = function (width, height, colorType, pixels) {
            if (!ArrayBuffer.isView(pixels)) {
                throw new Error("Pixels must be an ArrayBufferView (like Uint8Array)");
            }
            if (!(pixels instanceof Uint8Array)) {
                pixels = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
            }
            let bytesPerPixel = 1;
            if (colorType == 4) bytesPerPixel = 2;
            if (colorType == 2) bytesPerPixel = 3;
            if (colorType == 6) bytesPerPixel = 4;
            const scanWidth = width * bytesPerPixel + 1;//RGB or RGBA, plus filter byte
            if (pixels.length !== width * height * bytesPerPixel) {
                throw new Error("pixels length does not match expected image size for given colorType");
            }
            let pngPixels = new Uint8Array(scanWidth * height);

            for (let y = 0; y < height; y++) {
                const rowStart = y * width * bytesPerPixel; // source row start in input
                const outStart = y * scanWidth;             // output row start in PNG
                //pngPixels[outStart] = 0; // Set filter type to 0 ("None")
                // Copy a row of pixels
                pngPixels.set(
                    pixels.subarray(rowStart, rowStart + width * bytesPerPixel),
                    outStart + 1
                );
            }
            return new Png(width, height, colorType, pngPixels);
        }

        /**
        * @param {HTMLCanvasElement} canvas
        * @param {Number} compressionLevel
        * @param {PNGJS.colorType} colorType 
       */
        PNGJS.pngBytesFromCanvas = function (canvas, compressionLevel, colorType) {
            "use strict";
            if (colorType == PNGJS.ColorType.Palette) {
                return PNGJS.pngBytesFromCanvasPalletized(canvas, compressionLevel);
            }
            if (!canvas || !canvas.width || !canvas.height) return;
            var pngWidth = canvas.width;
            var pngHeight = canvas.height;
            var ctx = canvas.getContext("2d");
            var iDat = ctx.getImageData(0, 0, pngWidth, pngHeight);
            //var buf = new Uint32Array(iDat.data.buffer);
            var byteWidth = pngWidth * 4;
            var pngBytes = new Uint8Array((byteWidth + 1) * pngHeight);
            var datBytes = new Uint8Array(iDat.data.buffer);
            var pngPtr = 0;
            var yOff = 0;
            for (var y = 0; y < pngHeight; y++) {
                pngPtr++;
                yOff = y * byteWidth;
                for (var x = 0; x < byteWidth; x++) {
                    pngBytes[pngPtr] = datBytes[yOff + x];
                    pngPtr++;
                }
            }
            var p = PNGJS.Create(pngWidth, pngHeight, 6, pngBytes);
            datBytes = null;
            pngBytes = null;
            iDat = null;
            return p.getBytes(compressionLevel);
        }


        PNGJS.pngBytesFromCanvas2 = function (canvas, compressionLevel, colorType) {
            if (colorType == PNGJS.ColorType.Palette) {
                return PNGJS.pngBytesFromCanvasPalletized(canvas, compressionLevel);
            }
        }

        /**
        * @param {HTMLCanvasElement} canvas
        * @param {Number} compressionLevel
        * @param {PNGJS.colorType} colorType 
        */
        PNGJS.pngDataUriFromCanvas = async function (canvas, compressionLevel, colorType) {
            const buffer = PNGJS.pngBytesFromCanvas(canvas, compressionLevel, colorType);
            // use a FileReader to generate a base64 data URI:
            const base64url = await new Promise(r => {
                const reader = new FileReader();
                reader.onload = () => r(reader.result);
                reader.readAsDataURL(new Blob([buffer]));
            });
            return "data:image/png;base64" + base64url.slice(base64url.indexOf(','));
        }

        if (!Uint8Array.prototype.slice) {
            Object.defineProperty(Uint8Array.prototype, 'slice', {
                value: Array.prototype.slice
            });
        }

        PNGJS.pngBytesFromCanvasPalletized = function (canvas, compressionLevel) {
            const palletized = processImageWithPalette(canvas);
            const png = PNGJS.Create(canvas.width, canvas.height, PNGJS.ColorType.Palette, palletized.processedPixels);

            for (let i = 0; i < palletized.palette.length; i++) {
                if (palletized.palette[i]) {
                    png.addColor(palletized.palette[i][0], palletized.palette[i][1], palletized.palette[i][2]);
                }
            }

            if (palletized.transparentIndex != null) {
                png.transparency = new Uint8Array(256); // Default all to fully opaque
                png.transparency.fill(255); // Fully opaque by default
                png.transparency[palletized.transparentIndex] = 0;
            }
            return png.getBytes(compressionLevel);
        }
        //TODO: integrate this more
        function processImageWithPalette(canvas) {
            const ctx = canvas.getContext("2d");
            const width = canvas.width;
            const height = canvas.height;

            // Get image data
            const imageData = ctx.getImageData(0, 0, width, height);
            const pixels = imageData.data;

            // Constants
            const transparencyThreshold = 90; // 35% opacity
            const transparentIndex = 0; // Reserve palette index 0 for transparency
            const maxPaletteSize = 255;

            // Step 1: Separate colors into opaque and transparent pixels
            const opaqueColors = [];
            let hasTransparentPixels = false;
            function clampInt(number, min, max) {
                return Math.max(min, Math.min(Math.round(number), max));
            }

            for (let i = 0; i < pixels.length; i += 4) {
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                const alpha = pixels[i + 3];

                if (alpha <= transparencyThreshold) {
                    // Mark as transparent
                    hasTransparentPixels = true;
                } else {
                    if (alpha < 255) {
                        // Blend with white background
                        const a = alpha / 256; // Alpha normalized to [0, 1]
                        const wv = 255 * (1 - a);
                        const newR = clampInt(r * a + wv, 0, 255);
                        const newG = clampInt(g * a + wv, 0, 255);
                        const newB = clampInt(b * a + wv, 0, 255);
                        pixels[i] = newR;
                        pixels[i + 1] = newG;
                        pixels[i + 2] = newB;
                        opaqueColors.push([newR, newG, newB]);
                    } else {
                        // Fully opaque pixel
                        opaqueColors.push([r, g, b]);
                    }
                }
            }

            // Step 2: Generate the palette
            const grayscaleColors = generateGrayscaleShades(16); //need grayscale shades for grey images to look right
            const colorWheel = [
                [255, 0, 0],    // Red
                [255, 127, 0],  // Orange
                [255, 255, 0],  // Yellow
                [127, 255, 0],  // Yellow-Green
                [0, 255, 0],    // Green
                [0, 255, 127],  // Cyan-Green
                [0, 255, 255],  // Cyan
                [0, 127, 255],  // Blue-Cyan
                [0, 0, 255],    // Blue
                [127, 0, 255],  // Violet
                [255, 0, 255],  // Magenta
                [255, 0, 127],  // Red-Magenta
            ];
            const remainingColors = maxPaletteSize - 1 - grayscaleColors.length;// - colorWheel.length;

            const medianCutPalette = medianCut(opaqueColors, remainingColors);
            const palette = [null].concat(grayscaleColors, medianCutPalette);//first entry is transparent

            const processedPixels = new Uint8Array((width + 1) * height);
            for (let i = 0; i < height; i++) {
                let yOff = i * width;
                let yOff1 = i * (width + 1);
                for (let j = 0; j < width; j++) {
                    const k = (yOff + j) * 4;
                    const alpha = pixels[k + 3];
                    if (alpha > transparencyThreshold) {
                        const color = [pixels[k], pixels[k + 1], pixels[k + 2]];
                        const paletteIndex = findClosestPaletteIndex(color, palette);
                        processedPixels[yOff1 + j + 1] = paletteIndex;
                        //pxDat[yOff1 + j + 1] = result.processedPixels[yOff + j];
                    } else {
                        processedPixels[yOff1 + j + 1] = transparentIndex;
                    }
                }
            }

            palette[0] = [255, 0, 0];//placeholder for transparent
            // Return results
            return {
                palette,
                processedPixels,
                transparentIndex: hasTransparentPixels ? transparentIndex : null, // Null if no transparent pixels
            };

            // Helper Functions

            // Generates a range of grayscale shades
            function generateGrayscaleShades(count) {
                const shades = [];
                for (let i = 0; i < count; i++) {
                    const value = Math.round((i / (count - 1)) * 255);
                    shades.push([value, value, value]);
                }
                return shades;
            }

            // Median Cut Algorithm
            function medianCut(colors, numColors) {
                if (colors.length <= numColors) return colors;

                let boxes = [{ colors: colors, range: getRange(colors) }];
                while (boxes.length < numColors) {
                    boxes.sort((a, b) => b.range.size - a.range.size);
                    const box = boxes.shift();
                    const [box1, box2] = splitBox(box);
                    boxes.push(box1, box2);
                }
                return boxes.map(box => averageColor(box.colors));
            }

            // Get the range of colors in a box
            function getRange(colors) {
                const min = [255, 255, 255];
                const max = [0, 0, 0];
                colors.forEach(([r, g, b]) => {
                    min[0] = Math.min(min[0], r);
                    min[1] = Math.min(min[1], g);
                    min[2] = Math.min(min[2], b);
                    max[0] = Math.max(max[0], r);
                    max[1] = Math.max(max[1], g);
                    max[2] = Math.max(max[2], b);
                });
                const range = max.map((v, i) => v - min[i]);
                return { min, max, size: Math.max(...range), dimension: range.indexOf(Math.max(...range)) };
            }

            // Split a color box into two
            function splitBox(box) {
                const { colors, range } = box;
                const { dimension } = range;
                colors.sort((a, b) => a[dimension] - b[dimension]);
                const mid = Math.floor(colors.length / 2);
                return [
                    { colors: colors.slice(0, mid), range: getRange(colors.slice(0, mid)) },
                    { colors: colors.slice(mid), range: getRange(colors.slice(mid)) }
                ];
            }

            // Calculate the average color of a box
            function averageColor(colors) {
                const total = [0, 0, 0];
                colors.forEach(([r, g, b]) => {
                    total[0] += r;
                    total[1] += g;
                    total[2] += b;
                });
                return total.map(c => Math.round(c / colors.length));
            }

            // Find the closest palette index for a given color
            function findClosestPaletteIndex(color, palette) {
                let closestIndex = 0;
                let minDistance = Infinity;

                for (let i = 1; i < palette.length; i++) { // Skip index 0 (transparent)
                    const paletteColor = palette[i];
                    const distance = getColorDistance(color, paletteColor);
                    if (distance < minDistance) {
                        minDistance = distance;
                        closestIndex = i;
                    }
                }
                return closestIndex;
            }

            // Calculate Euclidean distance between two colors
            function getColorDistance([r1, g1, b1], [r2, g2, b2]) {
                return Math.sqrt(
                    (r1 - r2) ** 2 +
                    (g1 - g2) ** 2 +
                    (b1 - b2) ** 2
                );
            }
        }
    }
}())


