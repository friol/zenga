
/* 

    Zenga emulator 2k23

*/

var glbMMU;
var glbCPU;
var glbCartridge;

// fps counter
var frameTime = 0;
var lastLoop = new Date;
var thisLoop=undefined;

//

function drawDebugPanel(instructions)
{
    var ycoord=16;
    const canvas=document.getElementById("debugCanvas");
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled= false;
    ctx.textRendering = "optimizeLegibility";

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.fill();

    // draw box around current instruction
    ctx.beginPath();
    ctx.lineWidth = "1";
    ctx.strokeStyle = "green";
    ctx.rect(0, 0, 290, 20);
    ctx.stroke();    

    // instructions

    ctx.font = "20px terminalfont";
    ctx.fillStyle = "black";

    for (var i=0;i<instructions.length;i++)
    {
        var dbgString="";
        dbgString+=instructions[i].address.toString(16).padStart(4, '0');
        dbgString+=" ";
        for (var b=0;b<4;b++)
        {
            if (instructions[i].bytes.length>b)
            {
                dbgString+=instructions[i].bytes[b].toString(16).padStart(2,'0')+" ";
            }
            else dbgString+="   ";
        }
        dbgString+=instructions[i].decodedString;
        ctx.fillText(dbgString,10,ycoord);
        ycoord+=20;
    }

    // registers
    var ycoord=16;
    var regxpos=400;

    ctx.fillText("AF: "+(glbCPU.registers.a).toString(16).padStart(2,'0')+(glbCPU.registers.f).toString(16).padStart(2,'0'),regxpos,ycoord);
    ycoord+=20;
    ctx.fillText("BC: "+(glbCPU.registers.b).toString(16).padStart(2,'0')+(glbCPU.registers.c).toString(16).padStart(2,'0'),regxpos,ycoord);
    ycoord+=20;
    ctx.fillText("DE: "+(glbCPU.registers.d).toString(16).padStart(2,'0')+(glbCPU.registers.e).toString(16).padStart(2,'0'),regxpos,ycoord);
    ycoord+=20;
    ctx.fillText("HL: "+(glbCPU.registers.h).toString(16).padStart(2,'0')+(glbCPU.registers.l).toString(16).padStart(2,'0'),regxpos,ycoord);
    ycoord+=20;
    ctx.fillText("IX: "+(glbCPU.registers.ixh).toString(16).padStart(2,'0')+(glbCPU.registers.ixl).toString(16).padStart(2,'0'),regxpos,ycoord);
    ycoord+=20;
    ctx.fillText("IY: "+(glbCPU.registers.iyh).toString(16).padStart(2,'0')+(glbCPU.registers.iyl).toString(16).padStart(2,'0'),regxpos,ycoord);

    ycoord+=40;
    ctx.fillText("SP: "+(glbCPU.registers.sp).toString(16).padStart(4,'0'),regxpos,ycoord);
    ycoord+=20;
    ctx.fillText("PC: "+(glbCPU.registers.pc).toString(16).padStart(4,'0'),regxpos,ycoord);
}

function emulate()
{
    // calc fps
    const filterStrength = 20;
    var thisFrameTime = (thisLoop=new Date) - lastLoop;
    frameTime+= (thisFrameTime - frameTime) / filterStrength;
    lastLoop = thisLoop;

    var fpsOut = document.getElementById('fpsSpan');
    var fpeez=(1000/frameTime).toFixed(1);
    fpsOut.innerHTML = "going at " + fpeez + " fps";

    var decodedInstrs=glbCPU.debugInstructions(16);
    drawDebugPanel(decodedInstrs);

    setTimeout(emulate,10);
}

function handleCartridgeUpload(fls)
{
	var arrayBuffer;
	var fileReader = new FileReader();
	fileReader.onload = function(event) 
	{
		var fname=document.getElementById("cartridgeSelector").value;

		if ((fname.toLowerCase().indexOf(".sms")<0)&&(fname.indexOf(".")>0))
		{
			alert("You can only load .sms files");
			return;
		}

        console.log("Loading cartridge ["+fname+"]");

		arrayBuffer = event.target.result;

        glbCartridge=new cartridge();
        glbCartridge.load(arrayBuffer);
        glbMMU=new smsMmu(glbCartridge);
        glbCPU=new z80cpu(glbMMU);

        emulate();
	};
	fileReader.readAsArrayBuffer(fls[0]);	
}

window.onload = (event) => 
{
    document.onkeydown = function(e)
	{
        //console.log(e.key);

    }

    document.onkeyup = function(e)
	{
        if (e.key=="s")
        {
            glbCPU.executeOne();
            e.preventDefault();
        }
    }

    //document.addEventListener('fullscreenchange', fullscreenchanged);

}
