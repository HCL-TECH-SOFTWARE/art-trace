/*******************************************************************************
Copyright 2025 HCL Software

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*******************************************************************************/

// Sample: translate an .art-trace file to Plant-UML format

import fs from 'fs';
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import readline from 'readline';
import { TraceParser, InstanceDecl, MessageOccurrance, TraceParserUtils } from 'art-trace';

const filePath = path.join(__dirname, '../traces/MoreOrLess/trace-with-timestamps.art-trace');

const lightGreen = '#37e937ff';
const darkBlue = '#003366';
const lightBlue = '#2e92b4';

const input = fs.createReadStream(filePath, { encoding: 'utf8' });
const rl = readline.createInterface({ input, crlfDelay: Infinity });
try {
    let i = 0;
    let instanceMap = new Map<string, InstanceDecl>();
    console.log("@startuml");
    let applicationParticipantDeclared = false;
    let systemParticipantDeclared = false;
    let timerParticipantDeclared = false;
    
    let traceParser = new TraceParser();

    for await (const line of rl) {        
        let astNode = traceParser.parseLine(line, i++);
        if (astNode instanceof InstanceDecl) {
            instanceMap.set(astNode.address.text, astNode);
        }   
        else if (astNode instanceof MessageOccurrance) {
            let senderInst = instanceMap.get(astNode.sender.text);
            let receiverInst = instanceMap.get(astNode.receiver.text);
            if (senderInst && receiverInst) {
                if (!applicationParticipantDeclared && (TraceParserUtils.isTopCapsuleInstance(senderInst) || TraceParserUtils.isTopCapsuleInstance(receiverInst))) {
                    applicationParticipantDeclared = true;
                    console.log(`participant application ${lightGreen}`);
                }
                if (!systemParticipantDeclared && (TraceParserUtils.isSystemInstance(senderInst) || TraceParserUtils.isSystemInstance(receiverInst))) {
                    systemParticipantDeclared = true;
                    console.log(`participant "<system>" ${lightBlue}`);
                }
                if (!timerParticipantDeclared && (TraceParserUtils.isTimerInstance(senderInst) || TraceParserUtils.isTimerInstance(receiverInst))) {
                    timerParticipantDeclared = true;
                    console.log(`participant "<timer>" ${lightBlue}`);
                }

                let senderLifeline = getLifeLineText(senderInst);
                let receiverLifeline = getLifeLineText(receiverInst);            

                let eventData = astNode.data.paramData;
                console.log(`"${senderLifeline}" -> "${receiverLifeline}": ${astNode.event.text}(${eventData})`);
            }
        }
    }
    console.log("@enduml");
}
finally {
    rl.close();
    input.close();
}

function getLifeLineText(participant: InstanceDecl): string {
    if (TraceParserUtils.isSystemInstance(participant))
        return "<system>";
    if (TraceParserUtils.isTimerInstance(participant))
        return "<timer>";

    return TraceParserUtils.structureExprToString(participant.structureExpr);
}