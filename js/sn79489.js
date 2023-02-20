/* SN79489 soundchip - vic's not vic ii */

/*
    The SN76489 has 8 "registers" - 4 x 4 bit volume registers, 3 x 10 bit
    tone registers and 1 x 4 bit noise register*.

    Channel   Volume registers   Tone/noise registers
    0 (%00)       Vol0                Tone0
    1 (%01)       Vol1                Tone1
    2 (%10)       Vol2                Tone2
    3 (%11)       Vol3                Noise
*/

class sn79489
{
    constructor()
    {
        this.volregister=[0xf,0xf,0xf,0xf];
        this.toneregister=[0,0,0,0];
        this.wavePos=[0,0,0,0];

        this.chan2belatched=0;
        this.what2latch=0;
        this.latch=0;

        //
        // audio engine
        //

        this.eventsQueue=new Array();
        this.internalClock=0;
        this.internalClockPos=0;

        this.squareWaveLen=8192;
        this.randDim=65536;
        this.randBuffer=new Array();
        for (var s=0;s<this.randDim;s++)
        {
            this.randBuffer.push(Math.random()*1.0);
        }
        this.randPos=0;

        this.audioInitialized=false;
    }

    startMix(thecpu)
    {
        try 
        {
            this.audioEnabled=true;
            //this.audioEnabled=false;
            //return;

            this.audioBufSize=1024;

            var self=this;
            this.webAudioAPIsupported=true;
    
            window.AudioContext = window.AudioContext||window.webkitAudioContext;
            this.context = new AudioContext();
    
            this.gainNode = this.context.createGain();
            this.gainNode.gain.value = 0.5;
    
            this.jsNode = this.context.createScriptProcessor(this.audioBufSize, 0, 2);
            this.jsNode.onaudioprocess = function(e)
            {
                self.mixFunction(e);
            }
    
            this.jsNode.connect(this.gainNode);
    
            this.gainNode.connect(this.context.destination);

            this.multiplier=Math.floor(thecpu.clockRate/this.jsNode.context.sampleRate);

            this.audioInitialized=true;
        }
        catch(e) 
        {
            alert('Error: Web Audio API is not supported in this browser. Buy a new one.');
            this.webAudioAPIsupported=false;
        }        
    }

    step(totCpuCycles)
    {
        this.internalClock=totCpuCycles;
    }

    mixFunction(e)
    {
        if (!this.audioEnabled) return;
        if (!this.audioInitialized) return;

        var dataL = e.outputBuffer.getChannelData(0);
        var dataR = e.outputBuffer.getChannelData(1);

        var numClocksToCover=this.internalClock-this.internalClockPos;
        if (numClocksToCover<=0) return;
        var realStep=numClocksToCover/(this.multiplier*this.audioBufSize);

        for (var s=0;s<this.audioBufSize;s++)
        {
            var runningTotal=0.0;

            for (var cyc=0;cyc<this.multiplier;cyc++)
            {
                // process queued events if current time >= event timestamp
                if ((this.eventsQueue.length>0)&&(this.eventsQueue[0][1]<=Math.floor(this.internalClockPos)))
                {
                    var curEvent=this.eventsQueue.shift();
                    var b=curEvent[0];

                    if (b&0x80)
                    {
                        // If bit 7 is 1 then the byte is a LATCH/DATA byte. 

                        this.chan2belatched=(b>>5)&0x03;
                        this.what2latch=((b&0x10)==0x10)?1:0; // Bit 4 determines whether to latch volume (1) or tone/noise (0) data 

                        if (this.what2latch==1)
                        {
                            this.volregister[this.chan2belatched]=b&0x0f;
                        }
                        else
                        {
                            this.toneregister[this.chan2belatched]=(this.toneregister[this.chan2belatched]&0xff00)|((b<<4)&0x00FF);
                        }
                    }
                    else
                    {
                        // If bit 7 is 0 then the byte is a DATA byte.

                        //If the currently latched register is a tone register then the low 6
                        //bits of the byte are placed into the high 6 bits of the latched
                        //register. Otherwise, the low 4 bits are placed into the low 4 bits
                        //of the relevant register*.

                        if (this.what2latch==1)
                        {
                            this.volregister[this.chan2belatched]=b&0xf;
                        }
                        else
                        {
                            this.toneregister[this.chan2belatched]=(this.toneregister[this.chan2belatched]&0xff)|((b<<8)&0x3F00);
                        }
                    }
                }

                //
                // MIX
                //

                //if (globalEmuStatus==1)
                {
                    runningTotal+=this.mixVoices()/4.0;                
                }

                this.internalClockPos+=realStep;
            }

            runningTotal/=this.multiplier;

            dataL[s]=runningTotal;
            dataR[s]=runningTotal;
        }

        if (this.eventsQueue.length>0) 
        {
            this.eventsQueue=[];        
        }
    }

    mixVoices()
    {
        if (glbEmulatorStatus!=1) return 0; // quiet if not running or anything

        var finalSample=0;

        for (var v=0;v<4;v++)
        //var v=3;
        {
            var curSamp=0;

            if (this.volregister[v]!=0xf)
            {
                if (this.toneregister[v]!=0)
                {
                    if (v<3)
                    {
                        var pos=Math.floor(this.wavePos[v]%this.squareWaveLen);
                        if (pos<(this.squareWaveLen/2)) curSamp=1.0;
                        var realFreq=(3579545.0/(32*this.toneregister[v]))/(this.multiplier*0.37);
                        this.wavePos[v]+=realFreq;
                        this.wavePos[v]%=this.squareWaveLen;
                    }
                    else
                    {
                        curSamp=this.randBuffer[this.randPos]*2.0;
                        this.randPos++;
                        this.randPos%=this.randDim;
                    }
                }

                curSamp=(curSamp*(0xf-this.volregister[v]))/0x0f;
                finalSample+=curSamp;
            }
        }

        return finalSample;
    }

    writeByte(b)
    {
        this.eventsQueue.push([b,this.internalClock]);
    }
}
