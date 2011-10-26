import Local

let Location = {
	navigate: javascriptHandler("LocationModule.navigate"),
	state: '',
}

<script>
void(function() {
	window.LocationModule = {
		navigate: _navigate
	}
	
	var _lastState = null,
		_pollInterval = 50
	
	function _navigate(state) {
		_lastState = state
		location.hash = '#'+state
		fun.set('Location.state', state)
	}
	
	function _pollHash() {
		var currentState = location.hash.substr(1)
		if (currentState == _lastState) { return }
		_navigate(currentState)
	}
	
	function _init() {
		_pollHash()
		setInterval(_pollHash, _pollInterval)
	}
	
	_init()
})()
</script>