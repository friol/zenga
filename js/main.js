
/* 

    Zenga emulator 2k23

*/

var glbCartridge;

// fps counter
var frameTime = 0;
var lastLoop = new Date;
var thisLoop=undefined;

//

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
	};
	fileReader.readAsArrayBuffer(fls[0]);	
}

window.onload = (event) => 
{
    document.onkeydown = function(e)
	{
    }

    document.onkeyup = function(e)
	{
    }

    //document.addEventListener('fullscreenchange', fullscreenchanged);

}
