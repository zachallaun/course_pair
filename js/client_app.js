;(function(exports) {

  // Section 1: Initialize global variables and do app server handshake

  // Media initialization varibles
  var getUserMedia = navigator.webkitGetUserMedia.bind(navigator),
      webRTCDetectedVersion = parseInt(navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./)[2]),
      localVideo,
      miniVideo,
      remoteVideo,
      mediaContainer,
      videoTracks;

  // Media constraints
  var sdpConstraints = {
    'mandatory': {
      'OfferToReceiveAudio': true,
      'OfferToReceiveVideo': true
    }
  };

  // Groundwork function completion variables
  var readyToConnect = false,
      localStream,
      turnDone,
      channelReady;

  // Connection and messaging variables
  var messageQueue = [],
      pc,
      socket,
      xmlhttp;

  // Application initialization variables (from server)
  var channelToken,
      userId,
      roomKey,
      initiator,
      pcConfig,
      pcConstraints,
      offerConstraints,
      mediaConstraints,
      turnUrl,
      stereo;

  var initialize = function(){
    console.log('Sending request for initialization variables')
    $.ajax({
      url: '/handshake',
      dataType: 'json',

      success: function(data) {
        console.log('Received intialization data from server: ' + data);
        clientData = data;

        channelToken = clientData['token'];
        userId = clientData['userId'];
        roomKey = clientData['room_key'];
        initiator = clientData['initiator'];
        pcConfig = clientData['pc_config'];
        pcConstraints = clientData['pc_constraints'];
        offerConstraints = clientData['offer_constraints'];
        mediaConstraints = clientData['media_constraints'];
        turnUrl = clientData['turn_url'];
        stereo = clientData['stereo'];

        callGroundworkFunctions();
      },
      error: function(_, errorMessage) {
        console.log('Handshake failed: ', status);
        alert('Initialization failed. Please exit video chat and try again.');
      }
    });
  }

  var callGroundworkFunctions = function() {
    activateVideo();
    sendTURNRequest();
    openChannel();
    console.log('Groundwork functions have been called');
  }

  // Called by all three Groundwork Function branches.
  // Makes sure all three branches have finished before executing.
  var startWhenReady = function() {
    if (localStream && turnDone && channelReady) {
      readyToConnect = true;
      if (initiator) {
        console.log('Initiator is ready to connect');
        sendPeerConnectionOffer();
      } else {
        console.log('Receiver is ready to connect');

        // Once ready, receiver process messages in message queue first
        while (messageQueue.length > 0) {
          processChannelMessage(messageQueue.shift());
        }

        // If messageQueue did not have offer in it, offer was likely
        // missed. Ask for offer to be resent.
        if (!pc) {
          sendMessage({ type: 'connectionRequest' });
        }
      }
    } else {
      console.log('Groundwork functions not yet finished.');
    }
  }


  // Section 2: Get local media

  var activateVideo = function() {
    console.log('Initializing media elements')
    localVideo = document.getElementById('localVideo');
    miniVideo = document.getElementById('miniVideo');
    remoteVideo = document.getElementById('remoteVideo');
    mediaContainer = document.getElementById('mediaContainer');
    tryGetUserMedia(mediaConstraints);
  }

  var tryGetUserMedia = function(constraints) {
    console.log('Attempting to get user media.');
    try {
      getUserMedia(constraints, onUserMediaSuccess, onUserMediaError);
    } catch(error) {
      alert('Failed to capture local media. Please try again.');
      console.log('getUserMedia failed with exception: ' + error.message);
    }
  }

  var onUserMediaSuccess = function(stream) {
    console.log('User has granted access to local media');
    localVideo.src = URL.createObjectURL(stream);
    localVideo.style.opacity = 1;
    localStream = stream;
    startWhenReady();
  }

  var onUserMediaError = function(error) {
    console.log('Failed to get access to local media. Error code was: ' +
                error.code);
  }


  // Section 3: Use STUN/TURN servers to identify available sockets

  var sendTURNRequest = function() {
    var numberOfServerObjects = pcConfig.iceServers.length;
    for (var i = 0; i < numberOfServerObjects; i++) {
      if (pcConfig.iceServers[i].url.substr(0,5) === 'turn:') {
        console.log('pcConfig initialization sent with TURN servers');
        return;
      }
    }
    console.log('pcConfig not initialized with any TURN servers. Sending TURN server request.');
    xmlhttp = new XMLHttpRequest();
    xmlhttp.onreadystatechange = onTURNResult;
    xmlhttp.open('GET', turnUrl, true);
    xmlhttp.send();
  }

  var onTURNResult = function() {
    if (xmlhttp.readyState !== 4) {
      return;
    }

    if (xmlhttp.status === 200) {
      var turnServer = JSON.parse(xmlhttp.responseText);
      var iceServer = createIceServer(turnServer.uris[0],
                                      turnServer.username,
                                      turnServer.password);
      pcConfig.iceServers.push(iceServer);
      console.log('TURN server request was successful.');
    } else {
      console.log('Request for TURN server failed. Will continue call with default STUN.');
    }
    turnDone = true;
    startWhenReady();
  }

  var createIceServer = function(turnUrl, username, password) {
    if (webRTCDetectedVersion < 28) {
      var iceServer = {
        'url': 'turn:' + username + '@' + turnUrl,
        'credential': password
      };
      return iceServer;
    } else {
      var iceServer = {
        'url': turnUrl,
        'credential': password,
        'username': username
      };
      return iceServer;
    }
  }

  var onIceCandidate = function(event) {
    if (event.candidate) {
      sendMessage({
        type: 'candidate',
        label: event.candidate.sdpMLineIndex,
        id: event.candidate.sdpMid,
        candidate: event.candidate.candidate
      });
    } else {
      console.log('End of candidates');
    }
  }


  // Section 4: Set up the channel

  var openChannel = function() {
    console.log('Opening the channel');
    var channel = new goog.appengine.Channel(channelToken);
    var handler = {
      'onopen': onChannelOpened,
      'onmessage': onChannelMessage,
      'onerror': onChannelError,
      'onclose': onChannelClosed
    };
    socket = channel.open(handler);
  }

  var onChannelOpened = function() {
    console.log('Channel opened');
    channelReady = true;
    startWhenReady();
  }

  var onChannelMessage = function(message) {
    var msg = JSON.parse(message.data);

    // Caches offer messages sent to receiver that
    // arrive before receiver's pc is set
    if (!initiator && !readyToConnect) {
      if (msg.type === 'offer') {
        messageQueue.unshift(msg);
        console.log(messageQueue);
        startWhenReady();
      } else {
        messageQueue.push(msg);
      }
    } else {
      processChannelMessage(msg);
    }
  }

  var onChannelError = function() {
    console.log('Channel error');
  }

  var onChannelClosed = function() {
    console.log('Channel closed');
  }


  // Section 5: Set up the peer connection

  var sendPeerConnectionOffer = function() {
    var mergedConstraints = mergeConstraints(offerConstraints, sdpConstraints);
    tryCreateConnection();
    console.log('Sending offer to peer');
    pc.createOffer(setLocalAndSendMessage, null, mergedConstraints);
  }

  var handlePeerConnectionOffer = function(message) {
    offerReceived = true;
    tryCreateConnection();
    if (stereo) {
      message.sdp = addStereo(message.sdp);
    }
    pc.setRemoteDescription(new RTCSessionDescription(message));
    sendPeerConnectionAnswer();
    console.log('Connection answer sent to peer');
  }

  var sendPeerConnectionAnswer = function() {
    console.log('Sending answer to peer.');
    pc.createAnswer(setLocalAndSendMessage, null, sdpConstraints);
  }

  var handlePeerConnectionAnswer = function(message) {
    if (stereo) message.sdp = addStereo(message.sdp);
    pc.setRemoteDescription(new RTCSessionDescription(message));
  }

  var setLocalAndSendMessage = function(sessionDescription) {
    // Set Opus as the preferred codec in SDP if Opus is present
    sessionDescription.sdp = preferOpus(sessionDescription.sdp);
    pc.setLocalDescription(sessionDescription);
    sendMessage(sessionDescription);
  }

  var tryCreateConnection = function() {
    try {
      pc = new webkitRTCPeerConnection(pcConfig, pcConstraints);
      pc.onicecandidate = onIceCandidate;
      console.log('Created a new peer connection')
      pc.addStream(localStream);
      pc.onaddstream = onRemoteStreamAdded;
      pc.onremovestream = onRemoteStreamRemoved;
    } catch (error) {
      console.log('Failed to create PeerConnection, exception: ' + error.message);
    }
  }


  // Section 6: Process channel messages once connection has been established

  var processChannelMessage = function(message) {
    console.log('Received a message from the server of type: ' + message.type);

    // For offers and answers, need to make sure that there is not currently
    // a peer connection before calling handlers
    if (message.type === 'offer') {
      handlePeerConnectionOffer(message);
    } else if (message.type === 'answer') {
      handlePeerConnectionAnswer(message);
    } else if (message.type === 'candidate') {
      handleCandidateMessage(message);
    } else if (message.type === 'connectionRequest') {
      startWhenReady();
    } else if (message.type === 'bye') {
      onHangup();
    } else {
      console.log('Received message of unknown type: ' + message);
    }
  }

  // Handles candidate messages, ensures that pc has been established
  // before calling addIceCandidate
  var handleCandidateMessage = function(message) {
    if (pc) {
      var candidate = new RTCIceCandidate({
        sdpMLineIndex: message.label,
        candidate: message.candidate
      });
      pc.addIceCandidate(candidate);
    } else {
      messageQueue.push(message);
    }
  }


  // Section 7: Manage remote video
  var onRemoteStreamAdded = function(event) {
    console.log('Remote stream added.');
    remoteStream = event.stream;
    miniVideo.src = localVideo.src;
    remoteVideo.src = URL.createObjectURL(event.stream);
    waitForRemoteVideo();
  }

  function onRemoteStreamRemoved(event) {
    console.log('Remote stream removed');
  }

  function waitForRemoteVideo() {
    videoTracks = remoteStream.getVideoTracks();
    if (videoTracks.length === 0 || remoteVideo.currentTime > 0) {
      transitionToActive();
    } else {
      console.log('Waiting for remote video');
      setTimeout(waitForRemoteVideo, 100);
    }
  }


  // Section 8: Session handlers

  function transitionToActive() {
    remoteVideo.style.opacity = 1;
    mediaContainer.style.webkitTransform = 'rotateY(180deg)';
    setTimeout(function() { localVideo.src = ''; }, 500);
    setTimeout(function() { miniVideo.style.opacity = 1; }, 1000);
  }

  var hangup = function() {
    onHangup();
    socket.close();
  }

  var onHangup = function() {
    if(pc) pc.close();
    pc = null;
  }

  window.onbeforeunload = function() {
    sendMessage({type: 'bye'});
    console.log('Bye sent on refreshing page to ensure room is cleaned.');
  }


  // Section 9: Utilities

  var sendMessage = function(message) {
    var msgString = JSON.stringify(message);
    var xhr = new XMLHttpRequest();

    console.log('Sending client to server message: ' + msgString);
    path = '/message?r=' + roomKey + '&u=' + userId;
    xhr.open('POST', path, true);
    xhr.send(msgString);
  }

  var mergeConstraints = function(cons1, cons2) {
    var merged = cons1;
    for (var name in cons2.mandatory) {
      merged.mandatory[name] = cons2.mandatory[name];
    }
    merged.optional.concat(cons2.optional);
    return merged;
  }


  // Section 10: Opus stuff (Direct C+P)

  // Set Opus as the default audio codec if it's present.
  function preferOpus(sdp) {
    var sdpLines = sdp.split('\r\n');

    // Search for m line.
    for (var i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search('m=audio') !== -1) {
        var mLineIndex = i;
        break;
      }
    }
    if (mLineIndex === null)
      return sdp;

    // If Opus is available, set it as the default in m line.
    for (var i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search('opus/48000') !== -1) {
        var opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
        if (opusPayload)
          sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex],
                                                 opusPayload);
        break;
      }
    }

    // Remove CN in m line and sdp.
    sdpLines = removeCN(sdpLines, mLineIndex);

    sdp = sdpLines.join('\r\n');
    return sdp;
  }

  // Set Opus in stereo if stereo is enabled.
  function addStereo(sdp) {
    var sdpLines = sdp.split('\r\n');

    // Find opus payload.
    for (var i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search('opus/48000') !== -1) {
        var opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
        break;
      }
    }

    // Find the payload in fmtp line.
    for (var i = 0; i < sdpLines.length; i++) {
      if (sdpLines[i].search('a=fmtp') !== -1) {
        var payload = extractSdp(sdpLines[i], /a=fmtp:(\d+)/ );
        if (payload === opusPayload) {
          var fmtpLineIndex = i;
          break;
        }
      }
    }
    // No fmtp line found.
    if (fmtpLineIndex === null)
      return sdp;

    // Append stereo=1 to fmtp line.
    sdpLines[fmtpLineIndex] = sdpLines[fmtpLineIndex].concat(' stereo=1');

    sdp = sdpLines.join('\r\n');
    return sdp;
  }

  function extractSdp(sdpLine, pattern) {
    var result = sdpLine.match(pattern);
    return (result && result.length == 2)? result[1]: null;
  }

  // Set the selected codec to the first in m line.
  function setDefaultCodec(mLine, payload) {
    var elements = mLine.split(' ');
    var newLine = new Array();
    var index = 0;
    for (var i = 0; i < elements.length; i++) {
      if (index === 3) // Format of media starts from the fourth.
        newLine[index++] = payload; // Put target payload to the first.
      if (elements[i] !== payload)
        newLine[index++] = elements[i];
    }
    return newLine.join(' ');
  }

  // Strip CN from sdp before CN constraints is ready.
  function removeCN(sdpLines, mLineIndex) {
    var mLineElements = sdpLines[mLineIndex].split(' ');
    // Scan from end for the convenience of removing an item.
    for (var i = sdpLines.length-1; i >= 0; i--) {
      var payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
      if (payload) {
        var cnPos = mLineElements.indexOf(payload);
        if (cnPos !== -1) {
          // Remove CN payload from m line.
          mLineElements.splice(cnPos, 1);
        }
        // Remove CN line in sdp
        sdpLines.splice(i, 1);
      }
    }

    sdpLines[mLineIndex] = mLineElements.join(' ');
    return sdpLines;
  }

  setTimeout(initialize, 1000);

}(this));
