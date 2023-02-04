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
        var numTestsFailed=0;

        console.log("Starting test ["+this.curTest+"]...");
        for (var testCaseNum=0;testCaseNum<10000;testCaseNum++)
        {
            //if (this.testJsonObject[testCaseNum].name=="40 ca 8b")
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
                this.theCpu.a=this.testJsonObject[testCaseNum].initial.a;
                this.theCpu.x=this.testJsonObject[testCaseNum].initial.x;
                this.theCpu.y=this.testJsonObject[testCaseNum].initial.y;
                this.theCpu.pc=this.testJsonObject[testCaseNum].initial.pc;
                this.theCpu.sp=this.testJsonObject[testCaseNum].initial.s;
                this.theCpu.setFlags(this.testJsonObject[testCaseNum].initial.p);

                // execute one opcode
                const cyclesElapsed=this.theCpu.executeOneOpcode();

                // compare registers with test case's
                if (this.theCpu.a!=this.testJsonObject[testCaseNum].final.a)
                {
                    console.log("testRunner::a is different from test case - case "+this.testJsonObject[testCaseNum].name);
                    testFailed=true;
                }
                if (this.theCpu.x!=this.testJsonObject[testCaseNum].final.x)
                {
                    console.log("testRunner::x is different from test case");
                    testFailed=true;
                }
                if (this.theCpu.y!=this.testJsonObject[testCaseNum].final.y)
                {
                    console.log("testRunner::y is different from test case");
                    testFailed=true;
                }
                if (this.theCpu.pc!=this.testJsonObject[testCaseNum].final.pc)
                {
                    console.log("testRunner::pc is different from test case - case "+this.testJsonObject[testCaseNum].name+
                    " Emulated pc: "+this.theCpu.pc+" Test case's pc: "+this.testJsonObject[testCaseNum].final.pc);
                    testFailed=true;
                }
                if (this.theCpu.sp!=this.testJsonObject[testCaseNum].final.s)
                {
                    console.log("testRunner::sp is different from test case");
                    testFailed=true;
                }
                var cpuFlags=parseInt(this.theCpu.getFlagsString(),2);
                if (cpuFlags!=this.testJsonObject[testCaseNum].final.p)
                {
                    console.log("testRunner::p is different from test case - case "+this.testJsonObject[testCaseNum].name+
                    " Emulated p: "+this.toBinary(cpuFlags)+" Test case's p: "+this.toBinary(this.testJsonObject[testCaseNum].final.p));
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
            }
        }
        console.log("Ending test... Num.Test Failed:"+numTestsFailed);
    }
}
