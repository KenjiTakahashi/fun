var fs = require('fs'),
	util = require('./compile_util'),
	compiler = exports

compiler.compile = function(ast) {
	var libraryPath = __dirname + '/lib.js',
		libraryCode,
		codeOutput
	
	try { libraryCode = fs.readFileSync(libraryPath).toString() }
	catch(e) { return {error: "Could not read library file", path: libraryPath, e: e} }
	
	var rootContext = {
		hookName: util.getHookName(),
		referenceTable: {}
	}
	
	try { codeOutput = compile(rootContext, ast) }
	catch(e) { return {error: "Could not compile", e: e} }
	
	return new util.CodeGenerator()
		.newline(2)
			.boxComment("Fun compiled at " + new Date().getTime())
		.newline(2)
			.boxComment("lib.js")
			.code(libraryCode)
		.newline(2)
			.boxComment("Compiled output: ")
			.declareHook(rootContext.hookName)
			.code('fun.setDOMHook('+rootContext.hookName+', document.body)')
			.code(codeOutput)
}

function compile(context, ast) {
	util.assert(context && context.hookName && context.referenceTable,
		"compile called with invalid context", {context:context})
	if (ast instanceof Array) {
		var result = []
		for (var i=0; i<ast.length; i++) {
			result.push(compile(context, ast[i]) + "\n")
		}
		return result.join("")
	} else if (typeof ast == 'object') {
		return compileFunStatement(context, ast) + "\n"
	}
}

function compileFunStatement(context, ast) {
	switch (ast.type) {
		case 'STRING':
			return util.q(ast.value)
		case 'NUMBER':
			return ast.value
		case 'DECLARATION':
			util.setReference(context, ast.name, ast.value)
			return ''
		case 'INLINE_VALUE':
			return getInlineValueCode(context, compileFunStatement(context, ast.value))
		case 'REFERENCE':
			if (ast.referenceType == "ALIAS") {
				return getInlineValueCode(context, util.q(util.getReference(context, ast.name).value))
			} else {
				return getReferenceCode(context, ast)
			}
		case 'IF_ELSE':
			return getIfElseCode(context, ast)
		case 'FOR_LOOP':
			return getForLoopCode(context, ast)
		case 'XML_NODE':
			return getXMLCode(context, ast)
		default:
			return util.q("UNDEFINED AST TYPE " + ast.type + ": " + JSON.stringify(ast));
	}
}

/**************
 * Inline XML *
 **************/
function getXMLCode(context, ast) {
	var tagName = ast.name,
		attrList = ast.attributes,
		content = ast.content
	
	var hookName = util.getHookName(),
		result = new util.CodeGenerator(),
		newContext = util.copy(context, {hookName: hookName}),
		attrs = {}
	
	result.declareHook(hookName)

	for (var i=0, attr; attr = attrList[i]; i++) {
		var value = getRefered(context, attr.value) // e.g. STRING, NUMBER
		if (attr.name == 'data') {
			if (tagName == 'input') { result.reflectInput(hookName, value) }
			else if (tagName == 'checkbox') { } // TODO
		} else if (attr.name == 'style') {
			util.assert(value.type == 'JSON_OBJECT', 'Style attribute must be JSON', {type: value.type})
			handleXMLStyle(newContext, value.content, attrs, result)
		} else if (attr.name == 'onClick') {
			util.assert(value.type == 'HANDLER', 'Handler attribute must be a HANDLER', {type: value})
			handleXMLOnClick(newContext, value.args, value.code, result)
		} else if (attr.value.type == 'REFERENCE') {
			result.bindAttribute(hookName, attr.name, attr.value)
		} else {
			attrs[attr.name] = value.value
		}
	}
	
	return result
		.createHook(context.hookName, hookName, tagName, attrs)
		.code(compile(newContext, content))
}

function handleXMLOnClick(context, args, mutationStatements, result) {
	var hookName = context.hookName,
		mutationCode = new util.CodeGenerator()
	for (var i=0, statement; statement = mutationStatements[i]; i++) {
		var target = statement.target
		util.assert(statement.type == 'MUTATION', 
			'Handler code should be mutation statements',{code:mutationStatements})
		util.assert(target.type == 'REFERENCE' && target.referenceType != 'ALIAS',
			'Target in mutation should be a local or a global data object', {target: target})
		mutationCode.mutate(statement.mutationType, target, getRefered(context, statement.source))
	}
	
	result
		.withHookStart(hookName, 'hook')
			.assign('hook.onclick', 'function(){')
				.code(mutationCode)
			.code('}')
		.withHookEnd()
}

function handleXMLStyle(context, styles, targetAttrs, result) {
	var hookName = context.hookName
	targetAttrs.style = ''
	for (var key in styles) {
		var styleRule = styles[key],
			styleValue = styleRule.value,
			styleType = styleRule.type
		
		if (styleType == 'REFERENCE') {
			result.bindStyle(hookName, key, styleRule)
		} else {
			var postfix = (styleType == 'NUMBER' ? 'px' : '')
			targetAttrs.style += key+':'+styleValue + postfix+'; '
		}
	}
}

/*************************
 * Values and References *
 *************************/
function getInlineValueCode(context, val) {
	var hookName = util.getHookName()
	return new util.CodeGenerator()
		.declareHook(hookName)
		.code(util.getHookCode(context.hookName, hookName), '.innerHTML=', val)
}

function getRefered(context, value) {
	if (value.type == 'REFERENCE' && value.referenceType == 'ALIAS') {
		return util.getReference(context, value.name)
	} else {
		return value
	}
}

function getReferenceCode(context, reference) {
	var parentHookName = context.hookName,
	    hookName = util.getHookName()
	return new util.CodeGenerator()
		.declareHook(hookName)
		.closureStart()
			.assign('hook', util.getHookCode(parentHookName, hookName))
			.callFunction('fun.observe', 
				util.q(reference.referenceType), 
				util.q(reference.value), 
				'function(mut,val){ hook.innerHTML=val }')
		.closureEnd()
}

/************************
 * If/Else control flow *
 ************************/
function getIfElseCode(context, ast) {
	var parentHook = context.hookName,
		cond = ast.condition,
		trueAST = ast.ifTrue,
		elseAST = ast.ifFalse
	
	var ifContext = util.copy(context, { hookName: util.getHookName() }),
		elseContext = util.copy(context, { hookName: util.getHookName() }),
		ifHookCode = util.getHookCode(parentHook, ifContext.hookName),
		elseHookCode = util.getHookCode(parentHook, elseContext.hookName),
		compareCode = '('+util.getCachedValue(cond.left) + cond.comparison + util.getCachedValue(cond.right)+')'
	
	return new util.CodeGenerator()
		.closureStart('ifPath', 'elsePath')
			.code(ifHookCode) // force creation of the dom hooks for proper ordering
			.code(elseHookCode)
			.assign('blocker', 'fun.getCallbackBlock(evaluate, {fireOnce: false})')
			.observe(cond.left, 'blocker.addBlock()')
			.observe(cond.right, 'blocker.addBlock()')
			.assign('lastTime', undefined)
			.functionStart('togglePath')
				.assign(ifHookCode+'.style.display', '(lastTime ? "block" : "none")')
				.assign(elseHookCode+'.style.display', '(lastTime ? "none" : "block")')
				.ifElse('lastTime', 'ifPath()', 'elsePath()')
			.functionEnd()
			.functionStart('evaluate')
				.assign('thisTime', compareCode)
				.returnIfEqual('thisTime', 'lastTime')
				.assign('lastTime', 'thisTime')
				.callFunction('togglePath')
			.functionEnd()
		.closureEnd(
			'\nfunction ifPath(){'+compile(ifContext, trueAST)+'}', 
			'\nfunction elsePath(){'+compile(elseContext, elseAST)+'}'
		)
}

/*************************
 * For loop control flow *
 *************************/

function getForLoopCode(context, ast) {
	var parentHookName = context.hookName,
		list = ast.list,
		codeAST = ast.code,
		loopHookName = util.getHookName(),
		emitHookName = util.getHookName(true),
		loopContext = util.copy(context, {hookName: emitHookName})
	
	loopContext.referenceTable = {}
	loopContext.referenceTable.__proto__ = context.referenceTable
	util.setReference(loopContext, ast.key, {value: 'SPECIAL_FOR_LOOP_REFERENCE - REPLACE WITH DYNAMIC VALUE'})
	
	// Create new context with referenceTable prototyping the current context's reference table
	return new util.CodeGenerator()
		.closureStart()
			.declareHook(loopHookName)
			.createHook(parentHookName, loopHookName)
			.observe(list, 'onMutation')
			.functionStart('onMutation', 'mutation')
				.log('mutation', 'arguments')
				.declareHook(emitHookName)
				.callFunction('fun.getDOMHook', loopHookName, emitHookName)
				// .code('fun.handleListMutation(mutation, function() {')
					.code(compile(loopContext, codeAST))
				// .code('})')
			.functionEnd()
		.closureEnd()
}

