
/* 

    Zenga emulator 2k23
    A lot of code due to:
    https://github.com/thunderholt/jsmastersystem

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

var glbEmulatorStatus=-1; // -1 warming up, 0 debugging, 1 running
var glbVideoctx;

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

    if (glbEmulatorStatus==1)
    {
        // emulate a batch of instructions (one frame)
        var emulatedCycles=0;

        // Refresh rate: 59.922743 Hz (NTSC)
        // Clock rate: 3.579545 MHz (NTSC)
        var targetCycles=Math.floor(glbCPU.clockRate/59.922743);

        while (emulatedCycles<targetCycles)
        {
            var cyc=glbCPU.executeOne();
            const needsBlit=glbVDP.update(glbCPU,cyc);

            if (needsBlit)
            {
                drawScreen();
            }

            emulatedCycles+=cyc;
        }
    }


    setTimeout(emulate,10);
}

function drawScreen()
{
    //if (glbEmulatorStatus==0)
    {
        var decodedInstrs=glbCPU.debugInstructions(numDebuggerLines);
        drawDebugPanel(decodedInstrs);
        const canvas=document.getElementById("debugCanvas");
        const ctx = canvas.getContext("2d");
        glbVDP.debugPalette(ctx,480,390);
        glbVDP.debugTiles(ctx,500,0);
    }

    //glbVDP.drawScreen(glbVideoctx);
    glbVDP.hyperBlit(glbVideoctx);
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

        glbEmulatorStatus=0;
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
        var cyc=glbCPU.executeOne();
        glbVDP.update(glbCPU,cyc);
    }
}

function runCPUTests(t)
{
    var tstMMU=new testMMU();
    var refCPU=new z80cpu(tstMMU);

    if (t==0)
    {
        for (var o=0;o<refCPU.unprefixedOpcodes.length;o++)
        //var o=0x17;
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
        //var o=0xa2;
        {
            if ((refCPU.prefixedOpcodes[o]!=undefined)&&(o!=0xb3)&&(o!=0x78))
            {
                var trunner=new cpuTestRunner("tests/ed "+o.toString(16).padStart(2,'0')+".json");
            }
        }
    }
    else if (t==0xdd)
    {
        for (var o=0;o<refCPU.prefixddOpcodes.length;o++)
        //var o=0xb3;
        {
            if ((refCPU.prefixddOpcodes[o]!=undefined))
            {
                var trunner=new cpuTestRunner("tests/dd "+o.toString(16).padStart(2,'0')+".json");
            }
        }
    }
    else if (t==0xddcb)
    {
        for (var o=0;o<refCPU.prefixddcbOpcodes.length;o++)
        //var o=0xb3;
        {
            if ((refCPU.prefixddcbOpcodes[o]!=undefined))
            {
                var trunner=new cpuTestRunner("tests/dd cb __ "+o.toString(16).padStart(2,'0')+".json");
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
    else if (t==0xfd)
    {
        for (var o=0;o<refCPU.prefixfdOpcodes.length;o++)
        //var o=0xb3;
        {
            if (refCPU.prefixfdOpcodes[o]!=undefined)
            {
                var trunner=new cpuTestRunner("tests/fd "+o.toString(16).padStart(2,'0')+".json");
            }
        }
    }
    else if (t==0xfdcb)
    {
        for (var o=0;o<refCPU.prefixfdcbOpcodes.length;o++)
        //var o=0xb3;
        {
            if ((refCPU.prefixfdcbOpcodes[o]!=undefined))
            {
                var trunner=new cpuTestRunner("tests/fd cb __ "+o.toString(16).padStart(2,'0')+".json");
            }
        }
    }
}

function hideDebugStuff()
{
    document.getElementById("debugCanvas").style.display="none";
    document.getElementById("debugButtons").style.display="none";
    document.getElementById("smsdisplay").style.width="768px";
    document.getElementById("smsdisplay").style.height="576px";
}

function showDebugStuff()
{
    document.getElementById("debugCanvas").style.display="block";
    document.getElementById("debugButtons").style.display="block";
    document.getElementById("smsdisplay").style.width="256px";
    document.getElementById("smsdisplay").style.height="192px";
}

window.onload = (event) => 
{
    document.onkeydown = function(e)
	{
        if (e.key=="s")
        {
            showDebugStuff();
            glbEmulatorStatus=0;
            var cyc=glbCPU.executeOne();
            glbVDP.update(glbCPU,cyc);
            e.preventDefault();
        }
        else if (e.key=="r")
        {
            var goout=false;
            while ((glbCPU.registers.pc!=glbBreakpoint)&&(!goout))
            {
                var cyc=glbCPU.executeOne();
                glbVDP.update(glbCPU,cyc);
                if (glbCPU.maskableInterruptWaiting)
                {
                    goout=true;
                }
            }
            e.preventDefault();
        }
        else if (e.key=="g")
        {
            // go (with the flow)
            hideDebugStuff();
            glbEmulatorStatus=1;
        }
        else if (e.key=="z") { glbMMU.pressButton1(); }
        else if (e.key=="x") { glbMMU.pressButton2(); }
        else if (e.key=="ArrowDown") { glbMMU.pressDown(); }
        else if (e.key=="ArrowUp") { glbMMU.pressUp(); }
        else if (e.key=="ArrowLeft") { glbMMU.pressLeft(); }
        else if (e.key=="ArrowRight") { glbMMU.pressRight(); }
    }

    document.onkeyup = function(e)
	{
        if (e.key=="z") { glbMMU.depressButton1(); }
        if (e.key=="x") { glbMMU.depressButton2(); }
        else if (e.key=="ArrowDown") { glbMMU.depressDown(); }
        else if (e.key=="ArrowUp") { glbMMU.depressUp(); }
        else if (e.key=="ArrowLeft") { glbMMU.depressLeft(); }
        else if (e.key=="ArrowRight") { glbMMU.depressRight(); }
    }

    var canvas = document.getElementById('debugCanvas');
    canvas.addEventListener("mousemove", function (e) 
    {
        if (glbEmulatorStatus==-1) return;

        var rect = canvas.getBoundingClientRect();
        var mousex=(e.clientX-rect.left);
        var mousey=(e.clientY-rect.top);

        var row=Math.floor(mousey/20);
        glbBpLine=row;

    }, false);

    canvas.addEventListener("mousedown", function (e) 
    {
        if (glbEmulatorStatus==-1) return; 

        var decodedInstrs=glbCPU.debugInstructions(numDebuggerLines);

        var rect = canvas.getBoundingClientRect();
        var mousex=(e.clientX-rect.left);
        var mousey=(e.clientY-rect.top);

        var row=Math.floor(mousey/20);
        glbBreakpoint=decodedInstrs[row].address;
    });    

    //document.addEventListener('fullscreenchange', fullscreenchanged);

    const videocanvas=document.getElementById("smsdisplay");
    glbVideoctx = videocanvas.getContext("2d");
}
