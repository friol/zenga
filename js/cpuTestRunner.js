/* 
    cpu test runner 
*/

class cpuTestRunner
{
    constructor(testsPath)
    {
        this.curTest=testsPath;
        this.theMMU=new testMMU();
        this.theCpu=new z80cpu(this.theMMU);
    
        this.testsLoaded=false;
        this.testJsonObject=undefined;

        var thisInstance=this;
        var oReq = new XMLHttpRequest();

        oReq.open("GET", testsPath, true);
        oReq.onload = function(oEvent) 
        {
          thisInstance.testJson = oReq.response;
          thisInstance.testJsonObject=JSON.parse(thisInstance.testJson);
          thisInstance.testsLoaded=true;
          thisInstance.runTests();
        };
        oReq.send();

    }

    toBinary(n)
    {
        return n.toString(2).padStart(8,'0');
    }

    runTests()
    {
        var numTestsExecuted=0;
        var numTestsFailed=0;

        console.log("Starting test ["+this.curTest+"]...");
        for (var testCaseNum=0;testCaseNum<1000;testCaseNum++)
        {
            //if (this.testJsonObject[testCaseNum].name=="30 0005")
            {
                var testFailed=false;
                // clean MMU memory
                this.theMMU.cleanMem();

                // set MMU memory to test case's
                for (var v=0;v<this.testJsonObject[testCaseNum].initial.ram.length;v++)
                {
                    this.theMMU.writeAddr(this.testJsonObject[testCaseNum].initial.ram[v][0],this.testJsonObject[testCaseNum].initial.ram[v][1]);
                }

                // set CPU registers to test case's
                this.theCpu.registers.a=this.testJsonObject[testCaseNum].initial.a;
                this.theCpu.shadowRegisters.a=this.testJsonObject[testCaseNum].initial.af_>>8;
                this.theCpu.registers.b=this.testJsonObject[testCaseNum].initial.b;
                this.theCpu.shadowRegisters.b=this.testJsonObject[testCaseNum].initial.bc_>>8;
                this.theCpu.registers.c=this.testJsonObject[testCaseNum].initial.c;
                this.theCpu.shadowRegisters.c=this.testJsonObject[testCaseNum].initial.bc_&0xff;
                this.theCpu.registers.d=this.testJsonObject[testCaseNum].initial.d;
                this.theCpu.shadowRegisters.d=this.testJsonObject[testCaseNum].initial.de_>>8;
                this.theCpu.registers.e=this.testJsonObject[testCaseNum].initial.e;
                this.theCpu.shadowRegisters.e=this.testJsonObject[testCaseNum].initial.de_&0xff;
                this.theCpu.registers.f=this.testJsonObject[testCaseNum].initial.f;
                this.theCpu.shadowRegisters.f=this.testJsonObject[testCaseNum].initial.af_&0xff;
                this.theCpu.registers.h=this.testJsonObject[testCaseNum].initial.h;
                this.theCpu.shadowRegisters.h=this.testJsonObject[testCaseNum].initial.hl_>>8;
                this.theCpu.registers.l=this.testJsonObject[testCaseNum].initial.l;
                this.theCpu.shadowRegisters.l=this.testJsonObject[testCaseNum].initial.hl_&0xff;
                this.theCpu.registers.r=this.testJsonObject[testCaseNum].initial.r;
                this.theCpu.registers.i=this.testJsonObject[testCaseNum].initial.i;

                this.theCpu.registers.ixl=this.testJsonObject[testCaseNum].initial.ix&0xff;
                this.theCpu.registers.ixh=this.testJsonObject[testCaseNum].initial.ix>>8;
                this.theCpu.registers.iyl=this.testJsonObject[testCaseNum].initial.iy&0xff;
                this.theCpu.registers.iyh=this.testJsonObject[testCaseNum].initial.iy>>8;

                this.theCpu.registers.pc=this.testJsonObject[testCaseNum].initial.pc;
                this.theCpu.registers.sp=this.testJsonObject[testCaseNum].initial.sp;

                const numCycles=this.testJsonObject[testCaseNum].cycles.length;

                // execute one opcode
                const emuCycles=this.theCpu.executeOne();

                // compare cycles
                if (emuCycles!=numCycles)
                {
                    console.log("testRunner::cycles do not match emu:"+emuCycles+" test:"+numCycles);
                }

                // compare registers with test case's
                if (this.theCpu.registers.a!=this.testJsonObject[testCaseNum].final.a)
                {
                    console.log("testRunner::a is different from test case - initial a: ["+
                    this.testJsonObject[testCaseNum].initial.a.toString(16)+"] emulated a: ["+
                    this.theCpu.registers.a.toString(16)+"] test final a ["+
                    this.testJsonObject[testCaseNum].final.a.toString(16)+"]"
                    ); 
                    testFailed=true;
                }
                if (this.theCpu.registers.b!=this.testJsonObject[testCaseNum].final.b)
                {
                    console.log("testRunner::b is different from test case");
                    testFailed=true;
                }
                if (this.theCpu.registers.c!=this.testJsonObject[testCaseNum].final.c)
                {
                    console.log("testRunner::c is different from test case");
                    testFailed=true;
                }
                if (this.theCpu.registers.d!=this.testJsonObject[testCaseNum].final.d)
                {
                    console.log("testRunner::d is different from test case");
                    testFailed=true;
                }
                if (this.theCpu.registers.e!=this.testJsonObject[testCaseNum].final.e)
                {
                    console.log("testRunner::e is different from test case");
                    testFailed=true;
                }
                if ((this.theCpu.registers.f&0xd7)!=(this.testJsonObject[testCaseNum].final.f&0xd7))
                {
                    console.log("testRunner::f is different from test case - initial f: ["+
                    this.toBinary(this.testJsonObject[testCaseNum].initial.f)+" emulated f: ["+
                    this.toBinary(this.theCpu.registers.f)+"] final f ["+
                    this.toBinary(this.testJsonObject[testCaseNum].final.f)+"]"
                    );
                    testFailed=true;
                }
                if (this.theCpu.registers.h!=this.testJsonObject[testCaseNum].final.h)
                {
                    console.log("testRunner::h is different from test case "+
                        this.theCpu.registers.h.toString(16)+" "+this.testJsonObject[testCaseNum].final.h.toString(16)
                        );
                    testFailed=true;
                }
                if (this.theCpu.registers.l!=this.testJsonObject[testCaseNum].final.l)
                {
                    console.log("testRunner::l is different from test case");
                    testFailed=true;
                }
                if (this.theCpu.registers.pc!=this.testJsonObject[testCaseNum].final.pc)
                {
                    console.log("testRunner::pc is different from test case - case "+this.testJsonObject[testCaseNum].name+
                    " Emulated pc: "+this.theCpu.registers.pc+" Test case's pc: "+this.testJsonObject[testCaseNum].final.pc);
                    testFailed=true;
                }
                if (this.theCpu.registers.sp!=this.testJsonObject[testCaseNum].final.sp)
                {
                    console.log("testRunner::sp is different from test case: emulated sp ["+
                    this.theCpu.registers.sp+"] test case's sp ["+this.testJsonObject[testCaseNum].final.sp+"]");
                    testFailed=true;
                }

                // compare memory with test case's
                for (var v=0;v<this.testJsonObject[testCaseNum].final.ram.length;v++)
                {
                    const val=this.theMMU.readAddr(this.testJsonObject[testCaseNum].final.ram[v][0]);
                    if (val!=this.testJsonObject[testCaseNum].final.ram[v][1])
                    {
                        console.log("testRunner::memory location ["+this.testJsonObject[testCaseNum].final.ram[v][0]+
                        "] value ["+val+"] different from test case ["+this.testJsonObject[testCaseNum].final.ram[v][1]+"]");
                        testFailed=true;
                    }
                }

                if (testFailed) numTestsFailed++;
                numTestsExecuted++;
            }
        }
        console.log("Ending test... Num. Test Executed: "+numTestsExecuted+" Num.Test Failed:"+numTestsFailed);
    }
}
