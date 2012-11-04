var events = require('events');
var stream = require('stream');
var util = require('util');

var runner = function(template, output) {
	stream.call(this);
	
	this.readable = true;
	this.writable = true;
	
	this.stack = [];
	this.skippingBlock = false;
	this.i = 0;
	this.template = template;
	
	this.variables = {};
	this.varEvents = new events.EventEmitter();
	
	this.running = false;
	
	if (output) {
		this.pipe(output);
	}
};
util.inherits(runner, stream);

runner.prototype.pipe = function(output){
	stream.prototype.pipe.apply(this, arguments);
	if (!this.running) {
		this.running = true;
		this.next();
	}
};

runner.prototype.write = function(data){
	this.emit('data', data);
};

runner.prototype.next = function(){
	var line = this.template[ this.i ];
	if (typeof line == 'undefined') return;
	
	this.i++;
	
	if (typeof line == 'object') {
		var functionName = line.slice(0, 1);
		var args = line.slice(1);
		
		var fn = this.fn[ functionName ];
		
		if (fn.startBlock) {
			this.startBlock();
		}
		if (fn.endBlock) {
			this.endBlock();
		}
		
		if (!this.skippingBlock) {
			fn.apply(this, args);
		} else {
			this.next();
		}
	} else if (!this.skippingBlock) {
		this.emit('data', line);
		this.next();
	} else {
		this.next();
	}
};

runner.prototype.startBlock = function(){
	this.stack.push(this.i);
};
runner.prototype.endBlock = function(){
	var beginning = this.stack.pop();
	if (this.skippingBlock && this.stack.length < this.skippingBlock) {
		//we're out of the loop. Yay.
		this.skippingBlock = false;
	}
	return beginning;
};
runner.prototype.restartBlock = function(){
	this.i = this.endBlock();
	this.next();
};
runner.prototype.skipBlock = function(){
	this.skippingBlock = this.stack.length;
};

runner.prototype.set = function(varName, value){
	var varStack = varName.split('.');
	if (varStack.length > 1) {
		var cursor = this.variables;
		var lastPiece = varStack.pop();
		for (var i in varStack) {
			cursor = cursor[ varStack[i] ];
		}
		cursor[lastPiece] = value;
		
		var firstPiece = varStack[0];
		this.varEvents.emit(firstPiece, this.variables[ firstPiece ]);
	} else {
		this.variables[ varName ] = value;
		this.varEvents.emit(varName, value);
	}
};

runner.prototype.get = function(varName, callback){
	var cursor = this.variables;
	var pieces;
	if (typeof varName == 'string') {
		pieces = [varName];
	} else {
		pieces = varName.slice();
	}
	var firstPiece = pieces[0];
	var lastPiece = pieces.pop();
	var worked = true;
	for (var i in pieces) {
		if (typeof cursor[pieces[i]] == 'undefined') {
			worked = false;
			break;
		}
		cursor = cursor[pieces[i]];
	}
	if (worked && typeof cursor[ lastPiece ] != 'undefined') {
		callback(cursor[ lastPiece ]);
	} else {
		var self = this;
		this.varEvents.once(firstPiece, function(value){
			self.get(varName, callback);
		});
	}
};

runner.prototype.fn = {};
runner.prototype.filters = {};

runner.prototype.fn.var = function(varName){
	var args = Array.prototype.slice.call(arguments);
	var self = this;
	
	var filterList = args.slice(1);
	
	var firstFilter;
	var lastFilter;
	
	for (var i in filterList) {
		var filterName = filterList[i][0];
		var filterArgs = filterList[i].slice(1);
		
		var thisFilter = new this.filters[ filterName ](filterArgs);
		if (!firstFilter) {
			firstFilter = thisFilter;
		}
		if (lastFilter) {
			lastFilter.pipe(thisFilter);
		}
		lastFilter = thisFilter;
	}
	
	if (lastFilter) {
		var self = this;
		lastFilter.on('data', function(data){
			self.emit('data', data);
		});
		lastFilter.on('end', function(){
			self.next();
		});
	}
	
	this.get(varName, function(value){
		if (filterList.length) {
			if (typeof value == 'string') {
				firstFilter.write(value);
				firstFilter.end();
			} else {
				value.pipe(firstFilter);
			}
		} else {
			if (typeof value == 'object' && value.readable) {
				value.pipe(self);
			} else {
				self.write(''+value);
				self.next();
			}
		}
	});
};

runner.prototype.fn.if = function(item){
	var self = this;
	this.get(item, function(value){
		if (!value) {
			self.skipBlock();
			self.next();
		} else {
			self.next();
		}
	});
};
runner.prototype.fn.if.startBlock = true;

runner.prototype.fn.endif = function(){
	this.next();
};
runner.prototype.fn.endif.endBlock = true;

var makeFilter = function(){
	var newFilter = function(args){
		stream.call(this);
		this.readable = true;
		this.writable = true;
		
		this.args = args;
		
		this.once('newListener:data', function(){
			this.start();
		});
		this.on('end', function(){
			this.finish();
		});
	};
	util.inherits(newFilter, stream);
	
	newFilter.prototype.end = function(){
		this.emit('end');
	};
	
	newFilter.prototype.addListener = newFilter.prototype.on = function(event, listener){
		events.EventEmitter.prototype.addListener.apply(this, arguments);
		this.emit('newListener:'+event, listener);
	}
	newFilter.prototype.once = function(event, listener){
		events.EventEmitter.prototype.once.apply(this, arguments);
		this.emit('newListener:'+event, listener);
	}
	
	newFilter.prototype.write = function(data){
		this.emit('data', data);
	};
	
	newFilter.prototype.start = function(){};
	newFilter.prototype.finish = function(){};
	return newFilter;
};

var uppercase = makeFilter();
uppercase.prototype.write = function(data){
	this.emit('data', data.toUpperCase());
};
runner.prototype.filters.uppercase = uppercase;

var wrap = makeFilter();
wrap.prototype.start = function(){
	this.emit('data', this.args[0]);
};
wrap.prototype.finish = function(){
	this.emit('data', this.args[1]);
};

runner.prototype.filters.wrap = wrap;



var compiled = [
	'<!DOCTYPE html>\n<html lang="en">\n\t<head>\n\t\t<title>',
	['var', 'title', ['uppercase'], ['wrap', '[[ ', ' ]]']],
	'</title>\n\t</head>\n\t<body>\n\t\t<h1>',
	['var', 'title'],
	'</h1>\n\t<ul>\n\t\t<li id="',
	['var', ['firstItem', 'id']],
	'">',
	['var', ['firstItem', 'text']],
	'</li>\n\t\t<li id="',
	['var', ['secondItem', 'id']],
	'">',
	['var', ['secondItem', 'text']],
	'</li>\n\t</ul>\n\t',
	['if', 'bool'],
		'<p>',
		['var', 'bool'],
		'</p>\n\t',
	['endif'],
	'</body>\n</html>\n'
];

var testy = new runner(compiled, process.stdout);

var s = 300;

setTimeout(function(){
	testy.set('title', 'Test page');
}, s*1);

setTimeout(function(){
	testy.set('firstItem', {});
}, s*2);
setTimeout(function(){
	testy.set('firstItem.id', 1);
}, s*3);
setTimeout(function(){
	testy.set('firstItem.text', 'First Item');
}, s*4);

setTimeout(function(){
	testy.set('secondItem', {id: 2});
}, s*5);

setTimeout(function(){
	testy.set('secondItem.text', 'Second Item');
}, s*6);

setTimeout(function(){
	testy.set('bool', 'Cake');
}, s*7);



