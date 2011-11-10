var std = require('std'),
	parser = require('../../src/parser'),
	tokenizer = require('../../src/tokenizer'),
	a = require('../parser-mocks'),
	util = require("../../src/util")

test('text literal')
	.code('"hello world"')
	.expect(a.literal("hello world"))

test('number literal')
	.code('1')
	.expect(a.literal(1))

test('declaration')
	.code('let greeting = "hello"')
	.expect(a.declaration('greeting', a.literal("hello")))

test('alias single namespace')
	.code('greeting')
	.expect(a.alias('greeting'))

test('alias double namespace')
	.code('user.name')
	.expect(a.alias('user.name'))

test('parenthesized expression')
	.code('(1)')
	.expect(a.literal(1))

test('double parenthesized expression')
	.code('(("hello"))')
	.expect(a.literal("hello"))

test('addition')
	.code('1+1')
	.expect(a.composite(a.literal(1), '+', a.literal(1)))

test('parenthesized subtraction')
	.code('(((1-1)))')
	.expect(a.composite(a.literal(1), '-', a.literal(1)))

test('simple if statement')
	.code('if (1 < 2) { 1 }')
	.expect(a.ifElse(a.composite(a.literal(1), '<', a.literal(2)), a.literal(1)))

test('has no null statements or expressions')
	.code('\nlet foo="bar"\n1\n\n')
	.expect(a.declaration("foo",a.literal("bar")), a.literal(1))

test('parses empty program')
	.code('')
	.expect()

test('* operator precedence 1')
	.code('1 + 2 * 3')
	.expect(a.composite(a.literal(1), '+', a.composite(a.literal(2), '*', a.literal(3))))

test('* operator precedence 2')
	.code('1 * 2 + 3')
	.expect(a.composite(a.composite(a.literal(1), '*', a.literal(2)), '+', a.literal(3)))

test('triple nested operators')
	.code('1 + 2 + 3 + 4')
	.expect(a.composite(a.literal(1), '+', a.composite(a.literal(2), '+', a.composite(a.literal(3), '+', a.literal(4)))))

test('empty for loop over list literal')
	.code('for (iterator in [1,2,3]) {}')
	.expect(a.forLoop(a.list(a.literal(1), a.literal(2), a.literal(3)), 'iterator', []))

test('self-closing xml')
	.code('<div />')
	.expect(a.xml('div'))

test('inline javascript')
	.code('<script> var i = 1; function a() { alert(i++) }; setInterval(a); </script> let a = 1')
	.expect(a.inlineScript(' var i = 1; function a() { alert(i++) }; setInterval(a);'), a.declaration('a', a.literal(1)))

test('module import')
	.code('import Test')
	.expect(a.importModule('Test'))

test('file import')
	.code('import "test.fun"')
	.expect(a.importFile('test.fun'))

test('nested declaration')
	.code(
		'let foo = { nested: { cat:"yay" } }, bar = foo.nested',
		' foo bar foo.nested'
	)
	.expect(
		a.declarations(
			'foo', a.object({ nested:a.object({ cat:a.literal('yay') }) }),
			'bar', a.alias('foo.nested')
		),
		a.alias('foo'), a.alias('bar'), a.alias('foo.nested')
	)

test('just a declaration')
	.code('let foo = { bar:1 }')
	.expect(a.declaration('foo', a.object({ bar:a.literal(1) })))

test('a handler')
	.code(
		'let aHandler = handler(){}'
	)
	.expect(
		a.declaration('aHandler', a.handler())
	)

test('a button which mutates state')
	.code(
		'let foo="bar"',
		'<button></button onclick=handler(){ foo.set("cat") }>'
	)
	.expect(
		a.declaration('foo', a.literal("bar")),
		a.xml('button', { 'onclick':a.handler([],[
			a.mutation(a.alias('foo'), 'set', [a.literal("cat")])
		])})
	)

test('interface declarations')
	.code(
		'let Thing = { foo:Text, bar:Number }',
		'let ListOfThings=[ Thing ]',
		'let ListOfNumbers = [Number]',
		'let NumberInterface = Number'
	)
	.expect(
		a.declaration('Thing', a.interface({ foo:a.Text, bar:a.Number })),
		a.declaration('ListOfThings', a.interface([a.alias('Thing')])),
		a.declaration('ListOfNumbers', a.interface([a.Number])),
		a.declaration('NumberInterface', a.Number)
	)

test('typed value declarations')
	.code(
		'let Response = { error:Text, result:Text }',
		'let Response response = { error:"foo", result:"bar" }',
		'response'
	)
	.expect(
		a.declaration('Response', a.interface({ error:a.Text, result:a.Text })),
		a.declaration('response', a.object({ error:a.literal('foo'), result:a.literal('bar') }), a.alias('Response')),
		a.alias('response')
	)

test('typed function declaration and invocation')
	.code(
		'let Response = { error:Text, result:Text }',
		'let Response post = function(Text path, Anything params) {',
		'	return { error:"foo", response:"bar" }',
		'}',
		'let response = post("/test", { foo:"bar" })'
	)
	.expect(
		a.declaration('Response', a.interface({ error:a.Text, result:a.Text })),
		a.declaration('post', a.function([a.argument('path', a.Text), a.argument('params', a.Anything)], [
			a.return(a.object({ error:a.literal('foo'), response:a.literal('bar') }))
		]), a.alias('Response')),
		a.declaration('response', a.invocation(a.alias('post'), a.literal('/test'), a.object({ foo:a.literal('bar')})))
	)

/* Util
 ******/
function test(name) {
	util.resetUniqueID()
	var input
	return {
		code: function() {
			util.resetUniqueID()
			input = std.slice(arguments).join('\n')
			return this
		},
		expect: function() {
			var expected = std.slice(arguments),
				tokens = tokenizer.tokenize(input)
			module.exports['parse\t\t"'+name+'"'] = function(assert) {
				util.resetUniqueID()
				try { var output = parser.parse(tokens) }
				catch(e) { console.log("Parser threw"); throw e; }
				assert.deepEqual(output, expected)
				assert.done()
			}
			return this
		}
	}
}