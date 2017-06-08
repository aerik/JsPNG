function JsPNG(width, height, isGrey) {
    "use strict";
    function write(buffer, offset, byteAry) {
        for (var i = 0; i < byteAry.length; i++) {
            buffer[offset + i] = byteAry[i];
        }
    }

    var numChannels = 3;
    if(isGrey) numChannels = 1;
	
    /* helper functions */
    var intBuf = new Uint32Array(1);
    //var shortBuf = new Uint16Array(1);
    var bufSize4 = new Uint8Array(intBuf.buffer);
    //var bufSize2 = new Uint8Array(shortBuf.buffer);
    var intToBytes = function(someInt) {
        intBuf[0] = swap32(someInt);
        return bufSize4.slice();
    }

    var swap32 = function(val) {
        return ((val & 0xFF) << 24)
               | ((val & 0xFF00) << 8)
               | ((val >> 8) & 0xFF00)
               | ((val >> 24) & 0xFF);
    }
    var swap16 = function(val) {
        return ((val & 0xFF) << 8)
               | ((val >> 8) & 0xFF);
    }

    var scanWidth = (width * numChannels) + 1;
    var pxData = new Uint8Array(height * scanWidth);//add one for filter byte

    var mask1 = 255; //R
    var mask2 = mask1 << 8; //G
    var mask3 = mask1 << 16; //B

	if(isGrey){
		this.setPixel = function (x, y, pxVal) {
			var yOffset = y * scanWidth;
			pxData[yOffset + x + 1] = pxVal;
		}
	}else{
		this.setPixel = function (x, y, r, g, b) {
			var yOffset = y * scanWidth;
			var xOffset = x * 3;
			if (g === void (0)) { //see if r is an RGB integer
				var val = r;
				r = val & mask1;
				g = (val & mask2) >> 8;
				b = (val & mask3) >> 16;
			}
			pxData[yOffset + xOffset + 1] = r;
			pxData[yOffset + xOffset + 2] = g;
			pxData[yOffset + xOffset + 3] = b;
		}
    }

    var IHDRdataLen = 33;
    var IHDRdata = new Uint8Array(IHDRdataLen);
    //each is an array of byte values
    var magicNumberHdr = [137, 80, 78, 71, 13, 10, 26, 10];
    var IHDRlen = intToBytes(13);
    var IHDR = [73, 72, 68, 82];
    var widthBytes = intToBytes(width);
    var heightBytes = intToBytes(height);
    var bitDepth = [8];
    var colorType = [numChannels-1];//PNG color code
    var compMethod = [0];
    var filter = [0];
    var interlace = [0];
    write(IHDRdata, 0, magicNumberHdr);
    write(IHDRdata, 8, IHDRlen);
    write(IHDRdata, 12, IHDR);
    write(IHDRdata, 16, widthBytes);
    write(IHDRdata, 20, heightBytes);
    write(IHDRdata, 24, bitDepth);
    write(IHDRdata, 25, colorType);
    write(IHDRdata, 26, compMethod);
    write(IHDRdata, 27, filter);
    write(IHDRdata, 28, interlace);
    var IHDRchunk = IHDRdata.slice(12, 29);
    var IHDRcrc = intToBytes(crc32(IHDRchunk));
    write(IHDRdata, 29, IHDRcrc);

    //Palette - NOT USED RIGHT NOW
    //var PLTEdata = new Uint8Array(4 + 4 + 256 * 3 + 4);
    //var PLTELen = intToBytes(PLTEdata.length -4);
    //var PLTE = [80, 76, 84, 69];
    //write(PLTEdata, 0, PLTELen);
    //write(PLTEdata, 4, PLTE);
    //for (var p = 0; p < 256; p++) {
    //    write(PLTEdata, 8 + p * 3, [p, p, p]);
    //}
    //var PLTEcrc = intToBytes(crc32(PLTEdata.slice(4, PLTEdata.length - 4)));
    //write(PLTEdata, PLTEdata.length - 4, PLTEcrc);

    this.getBytes = function (compLevel) {
        //deflate pixeldata
        if (compLevel === void(0)) compLevel = 1;
        var defBytes = pako["deflate"](pxData, { level: compLevel });// , { level: 0 } no compression, level 1 is almost as fast
        var IDATlen = intToBytes(defBytes.length);
        var IDAT = [73, 68, 65, 84];

        var IENDlen = intToBytes(0);
        var IEND = [73, 69, 78, 68];
        var IENDcrc = intToBytes(crc32(IEND));

        var plteDataLen = 0;
        //var plteDataLen = PLTEdata.length;

        var dataLen = IHDRdata.length + IDATlen.length + IDAT.length + defBytes.length + 4 + IENDlen.length + IEND.length + IENDcrc.length;
        dataLen += plteDataLen;
        var data = new Uint8Array(dataLen);

        write(data, 0, IHDRdata);
        //write(data, 33, PLTEdata);
        write(data, 33 + plteDataLen, IDATlen);
        write(data, 37 + plteDataLen, IDAT);
        write(data, 41 + plteDataLen, defBytes);

        var idatData = new Uint8Array(37 + plteDataLen, data.length - 16);//includes the IDAT header

        var idatCRCposition = data.length - 16;
        var IDATcrc = intToBytes(crc32(idatData));

        write(data, idatCRCposition, IDATcrc);
        write(data, data.length - 12, IENDlen);
        write(data, data.length - 8, IEND);
        write(data, data.length - 4, IENDcrc);

        return data;
    }
}


//from https://stackoverflow.com/questions/18638900/javascript-crc32
var crc32 = (function () {
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
        var len = data.length;
        var crc = -1; // Begin with all bits set ( 0xffffffff )
        for (var i = 0, l = len; i < l; i++) {
            crc = crc >>> 8 ^ table[(crc ^ data[i]) & 255];
        }
        return (crc ^ -1) >>> 0; // Apply binary NOT
    };
})();
