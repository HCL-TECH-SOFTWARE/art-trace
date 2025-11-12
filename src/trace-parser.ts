/*******************************************************************************
* © Copyright HCL Technologies Ltd. 2025
*******************************************************************************/

import {Tokenizr} from "tokenizr"
export type Token = InstanceType<typeof Tokenizr.Token>;

/**
 * Utilities for parsing trace files
 * @author Mattias Mohlin
 */

let initializedScanner : Tokenizr | null = null;

// Initialize trace file scanner
function initScanner() : Tokenizr | null {
    if (initializedScanner)
        return initializedScanner;

    let lexer = new Tokenizr();

    initializedScanner = lexer;

    // Keyword
    lexer.rule(/instance|note/, (ctx, match) => {
        ctx.accept("keyword");
    });
    // Name
    lexer.rule(/[a-zA-Z_][a-zA-Z0-9_]*/, (ctx, match) => {
        ctx.accept("name");
    });        
    // String
    lexer.rule(/"((?:\\"|[^\r\n])*)"/, (ctx, match) => {
        let str = match[1].replace(/\\"/g, "\"");
        ctx.accept("string", str);
    });                
    // Line comment (//)
    // Note that we don't support block comments (/* */) since we are parsing line-by-line
    lexer.rule(/\/\/.*?$/, (ctx, match) => {
        ctx.ignore();
    });
    // Whitespace
    lexer.rule(/[ \t\r\n]+/, (ctx, match) => {
        ctx.ignore();
    });
    // Address
    lexer.rule(/0x([0-9a-f])+/, (ctx, match) => {
        ctx.accept("address");
    });
    // Number
    lexer.rule(/[0-9]+/, (ctx, match) => {
        ctx.accept("number", parseInt(match[0]))
    })        
    // Arrow (->)
    lexer.rule(/\-\>/, (ctx, match) => {
        ctx.accept("arrow");
    });
    // Dot (.)
    lexer.rule(/\./, (ctx, match) => {
        ctx.accept("dot");
    });
    // Open square bracket ([)
    lexer.rule(/\[/, (ctx, match) => {
        ctx.accept("open-square-bracket");
    });
    // Close square bracket (])
    lexer.rule(/\]/, (ctx, match) => {
        ctx.accept("close-square-bracket");
    });
    // Event data (any text enclosed in parentheses)
    lexer.rule(/\(.*$/, (ctx, match) => {
        let str = match[0];            
        let i = str.lastIndexOf(')');
        if (i != -1) 
            ctx.accept("event-with-data", str.substring(1, i));
        else
            ctx.accept("event-with-data", str.substring(1)); // Missing closing parenthesis
    });        
    // Colon (:)
    lexer.rule(/\:/, (ctx, match) => {
        ctx.accept("colon");
    });        

    return lexer;
}


/**
 * Parse a line from a trace file
 * @param line a line from a trace file to scan
 * @param line number in the document
 * @returns an AST node or null in case of syntax error
 * @throws an error if an internal error occurs (e.g. if the scanner could not be initialized)
 */
export function parseLine(line : string, lineNumber : number) : InstanceDecl | MessageOccurrance | Note | null {
    const lexer = initScanner(); // throws error in case scanner could not be initialized
    if (lexer == null)
        return null;

    lexer.input(line);
    //lexer.debug(true); // sometimes useful but slow    

    try {                
        let tokens = lexer.tokens();
        if (tokens.length == 1 && tokens[0].isA("EOF"))
            return null; // Empty line (or only containing whitespace)

        for (let token of tokens) {
            token.line = lineNumber;
        }

        // Scanning successful, now parse the tokens
        let instanceDecl = isInstanceDecl(tokens);
        if (instanceDecl)
            return instanceDecl;

        let messageOccurrance = isMessageOccurrance(tokens);
        if (messageOccurrance)
            return messageOccurrance;

        let note = isNote(tokens);
        if (note)
            return note;

        return null;
    }
    catch (e) {
        // Syntax error
        return null;
    }
}

/**
 * AST node for an instance declaration
 */
export class InstanceDecl {
    address : Token;    
    structureExpr : Token[] = []; // Simplified list of tokens with semantic significance
    dynamicType : Token; // Dynamic instance type (omitted for built-in TargetRTS instances)
}

export class MessageData {
    data : string;
    receiveTime : number; // Unix epoch in nanoseconds
}

/**
 * AST node for a message occurrance
 */
export class MessageOccurrance {
    sender : Token; // Address of sender
    receiver : Token; // Address of receiver
    senderName: string;
    receiverName: string;
    senderPort: Token;
    receiverPort: Token;
    senderPortIndex: number;
    receiverPortIndex: number;
    event: Token;
    data: string | MessageData;
}

/**
 * AST node for a note
 */
export class Note {    
    text: string;
}

/**
 * Utilities for working with a parsed trace
 */
export class TraceParserUtils {
    /**
     * Answers if the instance is the top capsule instance (application)
     */    
    public static isTopCapsuleInstance(astNode : InstanceDecl) : boolean {
        if (astNode.structureExpr.length == 1 && astNode.structureExpr[0].text == 'application')
            return true;

        return false;
    }

    /**
     * Answers if the instance is the system instance
     */
    public static isSystemInstance(astNode : InstanceDecl) : boolean {
        let str = TraceParserUtils.structureExprToString(astNode.structureExpr);
        return (str == "Top" && astNode.dynamicType.text == "RTSuperActor");
    }

    /**
     * Answers if the instance is the timer instance
     */
    public static isTimerInstance(astNode : InstanceDecl) : boolean {
        let str = TraceParserUtils.structureExprToString(astNode.structureExpr);
        return (str == "specials" && astNode.dynamicType.text == "RTTimerActor");
    }

    /**
     * Return a string representation of a structure expression 
     */
    public static structureExprToString(structureExpr: Token[]): string {
        let result = "";
        for (let token of structureExpr) {
            if (token.value !== undefined && typeof token.value === 'number') {
                result += '[' + token.value.toString() + ']';
            }
            else {
                if (result.length > 0)
                    result += '.';
                result += token.text;
            }
        }
        return result;
    }
}

/**
 * Attempt to match a sequence of tokens.
 * @param i index of start token (passed by reference)
 * @param tokens token sequence to match against
 * @param tokenKinds expected tokens (prefix a token with "kw:" if keyword)
 * @param onMatch callback function called if tokens were matched (if it returns true, i is advanced)
 * @returns true if tokens were successfully matched, false otherwise
 */
function matchTokens(i : {value : number}, tokens : Token[], tokenKinds : string[], onMatch : (tokens : Token[]) => boolean | void) : boolean {
    if (tokens.length < i.value + tokenKinds.length) 
        return false;

    for (let j = 0; j < tokenKinds.length; j++) {
        let isKeyword = tokenKinds[j].startsWith('kw:');
        if (!isKeyword && tokens[i.value + j].isA(tokenKinds[j])) continue;
        if (isKeyword && tokens[i.value + j].isA('keyword', tokenKinds[j].substring(3))) continue;
            
        return false; // Token did not match    
    }

    // All tokens matched
    let res = onMatch(tokens.slice(i.value, i.value + tokenKinds.length));
    if (res !== false)
        i.value += tokenKinds.length;    

    return true;
}

/**
 * If the tokens represent an instance declaration return an InstanceDecl, otherwise null
 * @param tokens 
 * @returns InstanceDecl or null
 */
function isInstanceDecl(tokens : Token[]) : InstanceDecl | null {
    let instanceDecl = new InstanceDecl();
    let index = {"value" : 0};

    // instance keyword and address (mandatory)
    if (! matchTokens(index, tokens, ['kw:instance', 'address'], (matchedToken) => {
        instanceDecl.address = matchedToken[1];
    })) 
        return null; // syntax error        
            
    // Expect here any number of dot-separated names optionally followed by an index specifier.
    // The sequence stops with a colon or EOF.            
    for (; index.value < tokens.length; ) {
        if (! matchTokens(index, tokens, ['name'], (matchedToken) => {
            instanceDecl.structureExpr.push(tokens[index.value]);
        })) 
            return null; // syntax error 

        // dot (optional)
        if (matchTokens(index, tokens, ['dot'], (matchedToken) => {}))
            continue; // Dot must be followed by a name

        // [index] (optional)
        matchTokens(index, tokens, ['open-square-bracket', 'number', 'close-square-bracket'], (matchedToken) => {
            instanceDecl.structureExpr.push(matchedToken[1]);
        });
            
        // dot (optional)
        if (matchTokens(index, tokens, ['dot'], (matchedToken) => {}))
            continue; // Dot must be followed by a name

        if (matchTokens(index, tokens, ['colon'], (matchedToken) => {
                return false; // do not consume the token
            }) ||
            matchTokens(index, tokens, ['EOF'], (matchedToken) => {}))
            break; // end of structure expression        
    }

    // : dynamic type (optional)
    matchTokens(index, tokens, ['colon', 'name'], (matchedToken) => {
        instanceDecl.dynamicType = matchedToken[1];
    });

    return instanceDecl;    
}

/**
 * If the tokens represent a message occurrence return a MessageOccurrance, otherwise null
 * @param tokens 
 * @returns MessageOccurrance or null
 */
function isMessageOccurrance(tokens : Token[]) : MessageOccurrance | null {    
    let messageOccurrance = new MessageOccurrance();

    let index = {"value" : 0};
    // sender address and name (mandatory)
    if (! matchTokens(index, tokens, ['address', 'name'], (matchedToken) => {
        messageOccurrance.sender = matchedToken[0];
        messageOccurrance.senderName = matchedToken[1].text;
    })) 
        return null; // syntax error

    // sender port (optional)
    matchTokens(index, tokens, ['dot', 'name'], (matchedToken) => {
        messageOccurrance.senderPort = matchedToken[1];
    });    

    // sender port index (optional)
    matchTokens(index, tokens, ['open-square-bracket', 'number', 'close-square-bracket'], (matchedToken) => {
        messageOccurrance.senderPortIndex = matchedToken[1].value as number;
    });    

    // -> receiver address and name (mandatory)
    if (! matchTokens(index, tokens, ['arrow', 'address', 'name'], (matchedToken) => {
        messageOccurrance.receiver = matchedToken[1];
        messageOccurrance.receiverName = matchedToken[2].text;
    })) 
        return null; // syntax error

    // receiver port (optional)
    matchTokens(index, tokens, ['dot', 'name'], (matchedToken) => {
        messageOccurrance.receiverPort = matchedToken[1];
    });    

    // receiver port index (optional)
    matchTokens(index, tokens, ['open-square-bracket', 'number', 'close-square-bracket'], (matchedToken) => {
        messageOccurrance.receiverPortIndex = matchedToken[1].value as number;
    }); 

    // : event with data (mandatory)
    if (! matchTokens(index, tokens, ['colon', 'name', 'event-with-data'], (matchedToken) => {
        messageOccurrance.event = matchedToken[1];
        // This is always the last token.
        // Token text should be JSON, but for backwards compatibility we accept any text.
        try {
            messageOccurrance.data = JSON.parse(matchedToken[2].value as string);
        } 
        catch (e) {
            messageOccurrance.data = matchedToken[2].value as string;
        }  
    })) 
        return null; // syntax error

    return messageOccurrance;    
}

/**
 * If the tokens represent a note return a Note, otherwise null
 * @param tokens 
 * @returns Note or null
 */
function isNote(tokens : Token[]) : Note | null {
    let note = new Note();
    let index = {"value" : 0};
    // sender address and name (mandatory)
    if (! matchTokens(index, tokens, ['kw:note', 'string'], (matchedToken) => {
        note.text = matchedToken[1].value as string;        
    })) 
        return null; // syntax error

    return note;    
}
