// Sample: translate an .art-trace file to the .ms format (see https://bramp.github.io/js-sequence-diagrams/)
import fs from 'fs';
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import readline from 'readline';
import { parseLine, InstanceDecl, MessageOccurrance, TraceParserUtils } from 'art-trace';

const filePath = path.join(__dirname, '../traces/MoreOrLess/trace-with-timestamps.art-trace');

const input = fs.createReadStream(filePath, { encoding: 'utf8' });
const rl = readline.createInterface({ input, crlfDelay: Infinity });
try {
    let i = 0;
    let instanceMap = new Map<string, InstanceDecl>();
    
    let applicationParticipantDeclared = false;
    let systemParticipantDeclared = false;
    let timerParticipantDeclared = false;
    for await (const line of rl) {        
        let astNode = parseLine(line, i++);
        if (astNode instanceof InstanceDecl) {
            instanceMap.set(astNode.address.text, astNode);
        }   
        else
        if (astNode instanceof MessageOccurrance) {
            let senderInst = instanceMap.get(astNode.sender.text);
            let receiverInst = instanceMap.get(astNode.receiver.text);
            let senderType = senderInst ? senderInst.dynamicType.text : "";
            let receiverType = receiverInst ? receiverInst.dynamicType.text : "";

            let eventData = typeof astNode.data === 'string' ? astNode.data : JSON.stringify(astNode.data);
            console.log(`${astNode.senderName}(${senderType}) -> ${astNode.receiverName}(${receiverType}) : ${astNode.event.text}(${eventData})`);
        }
    }
}
finally {
    rl.close();
    input.close();
}
