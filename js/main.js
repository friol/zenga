
/* 

    Zenga emulator 2k23

*/

var glbMMU;
var glbCPU;
var glbCartridge;
var glbVDP;

// fps counter
var frameTime = 0;
var lastLoop = new Date;
var thisLoop=undefined;

var glbBpLine=0;
var glbBreakpoint=-1;
const numDebuggerLines=20;

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
    ctx.rect(0, 0, 310, 20);
    ctx.stroke();    

    // instructions

    ctx.font = "20px terminalfont";

    for (var i=0;i<instructions.length;i++)
    {
        ctx.fillStyle = "black";

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
        if (glbBpLine==i)
        {
            ctx.fillText(">",0,ycoord);
        }

        if (glbBreakpoint==instructions[i].address)
        {
            ctx.fillStyle = "red";
            ctx.fillText("*",0,ycoord);
        }

        ctx.fillText(dbgString,20,ycoord);
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

    var decodedInstrs=glbCPU.debugInstructions(numDebuggerLines);
    drawDebugPanel(decodedInstrs);

    const canvas=document.getElementById("debugCanvas");
    const ctx = canvas.getContext("2d");
    glbVDP.debugPalette(ctx,480,390);
    glbVDP.debugTiles(ctx,500,0);

    const videocanvas=document.getElementById("smsdisplay");
    const videoctx = videocanvas.getContext("2d");
    glbVDP.drawScreen(videoctx);

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
        glbVDP=new smsVDP();
        glbMMU=new smsMmu(glbCartridge,glbVDP);
        glbCPU=new z80cpu(glbMMU);

        emulate();
	};
	fileReader.readAsArrayBuffer(fls[0]);	
}

function gotoAddress()
{
    var addr=document.getElementById("bpaddress").value;
    if (addr=="") return;

    const intAddr=parseInt(addr,16);
    glbBreakpoint=intAddr;

    while (glbCPU.registers.pc!=glbBreakpoint)
    {
        glbCPU.executeOne();
        glbVDP.update(glbCPU);
    }
}

function runCPUTests(t)
{
    var tstMMU=new testMMU();
    var refCPU=new z80cpu(tstMMU);

    if (t==0)
    {
        for (var o=0;o<refCPU.unprefixedOpcodes.length;o++)
        //o=0xdb;
        {
            if ((refCPU.unprefixedOpcodes[o]!=undefined)&&(o!=0xdb))
            {
                var trunner=new cpuTestRunner("tests/"+o.toString(16).padStart(2,'0')+".json");
            }
        }
    }
    else if (t==0xed)
    {
        for (var o=0;o<refCPU.prefixedOpcodes.length;o++)
        //var o=0xb3;
        {
            if ((refCPU.prefixedOpcodes[o]!=undefined)&&(o!=0xb3)&&(o!=0x78))
            {
                var trunner=new cpuTestRunner("tests/ed "+o.toString(16).padStart(2,'0')+".json");
            }
        }
    }
    else if (t==0xcb)
    {
        for (var o=0;o<refCPU.prefixcbOpcodes.length;o++)
        //var o=0xb3;
        {
            if (refCPU.prefixcbOpcodes[o]!=undefined)
            {
                var trunner=new cpuTestRunner("tests/cb "+o.toString(16).padStart(2,'0')+".json");
            }
        }
    }
  

    
}

window.onload = (event) => 
{
    document.onkeydown = function(e)
	{
        if (e.key=="s")
        {
            glbCPU.executeOne();
            glbVDP.update(glbCPU);
            e.preventDefault();
        }
        else if (e.key=="r")
        {
            var goout=false;
            while ((glbCPU.registers.pc!=glbBreakpoint)&&(!goout))
            {
                glbCPU.executeOne();
                glbVDP.update(glbCPU);
                if (glbCPU.maskableInterruptWaiting)
                {
                    goout=true;
                }
            }
            e.preventDefault();
        }
    }

    document.onkeyup = function(e)
	{
    }

    var canvas = document.getElementById('debugCanvas');
    canvas.addEventListener("mousemove", function (e) 
    {
        var rect = canvas.getBoundingClientRect();
        var mousex=(e.clientX-rect.left);
        var mousey=(e.clientY-rect.top);

        var row=Math.floor(mousey/20);
        glbBpLine=row;

    }, false);

    canvas.addEventListener("mousedown", function (e) 
    {
        var decodedInstrs=glbCPU.debugInstructions(numDebuggerLines);

        var rect = canvas.getBoundingClientRect();
        var mousex=(e.clientX-rect.left);
        var mousey=(e.clientY-rect.top);

        var row=Math.floor(mousey/20);
        glbBreakpoint=decodedInstrs[row].address;

        //console.log("Click on "+mousex+" "+mousey);
    });    

    //document.addEventListener('fullscreenchange', fullscreenchanged);
}
