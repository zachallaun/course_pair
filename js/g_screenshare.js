setTimeout(initialize, 1000);

var localVideo
, miniVideo
, remoteVideo
, localStream
, remoteStream
, channel
, pc
, socket
, xmlhttp
, started = false
, turnDone = false
, channelReady = false
, signalingReady = false
, msgQueue = [];

// Client data
var channelToken
, user_id
, roomKey
, initiator
, pcConfig
, pcConstraints
, offerConstraints
, mediaConstraints
, turnUrl
, stereo;

// Set up audio and video regardless of devices
var sdpConstraints = {'mandatory': {
                        'OfferToReceiveAudio': true,
                        'OfferToReceiveVideo': true}};
var isVideoMuted = false;
var isAudioMuted = false;
var webRTCDetectedVersion = parseInt(navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./)[2]);
var RTCPeerConnection = webkitRTCPeerConnection;
var getUserMedia = navigator.webkitGetUserMedia.bind(navigator);

// constraints for screen share
var shareConstraints = { video: {
                          'mandatory': {
                            chromeMediaSource: 'screen' }}};

function initialize() {
  $.ajax({
    url: "/handshake",
    dataType: 'json',
    success: function(data) {
      console.log(data);
      var clientData = data;

      channelToken = clientData['token'];
      user_id = clientData['user_id'];
      roomKey = clientData['room_key'];
      initiator = clientData['initiator'];
      pcConfig = clientData['pc_config'];
      pcConstraints = clientData['pc_constraints'];
      offerConstraints = clientData['offer_constraints'];
      mediaConstraints = clientData['media_constraints'];
      turnUrl = clientData['turn_url'];
      stereo = clientData['stereo'];

      initializeVideo();
    },
    error: function(_, status) {
      console.log("Handshake failed: ", status);
    }
  });
}

function initializeVideo() {
  console.log('Initializing; room=' + roomKey + '.');
  card = document.getElementById('card');
  localVideo = document.getElementById('localVideo');
  // Reset localVideo to display to center
  localVideo.addEventListener('loadedmetadata', function() {
    //window.onresize();
  });
  miniVideo = document.getElementById('miniVideo');
  remoteVideo = document.getElementById('remoteVideo');
  resetStatus();
  // Note: AppRTCClient.java searches & parses this line; update there when changing here
  openChannel();
  maybeRequestTurn();
  doGetUserMedia(mediaConstraints);
  // Caller is always ready to create peerConnection
  signalingReady = initiator;
}
// Creates the socket that the client listens on for messages from the server.
// Also sets the functions that will get called from socket action callbacks
function openChannel() {
  console.log('Opening channel.');
  var channel = new goog.appengine.Channel(channelToken);
  var handler = {
    'onopen': onChannelOpened,
    'onmessage': onChannelMessage,
    'onerror': onChannelError,
    'onclose': onChannelClosed
  };
  socket = channel.open(handler);
}

function maybeRequestTurn() {
  for (var i = 0, len = pcConfig.iceServers.length; i < len; i++) {
    console.log(pcConfig.iceServers);
    if (pcConfig.iceServers[i].url.substr(0,5) === 'turn:') {
      turnDone = true;
      return;
    }
  }
  var currentDomain = document.domain;
  if (currentDomain.search('localhost') === -1 &&
      currentDomain.search('apprtc' === -1)) {
      // Not authorized domain. Try with default STUN instead
      console.log("Domain not authorized.")
      turnDone = true;
      return;
  }
  xmlhttp = new XMLHttpRequest();
  xmlhttp.onreadystatechange = onTurnResult;
  console.log("Need to get a turn server. 'turnURL' is undefined.")
  xmlhttp.open('GET', turnUrl, true);
  xmlhttp.send();
}

function onTurnResult() {
  if (xmlhttp.readyState !== 4) {
    return;
  }
  if (xmlhttp.status === 200) {
    var turnServer = JSON.parse(xmlhttp.responseText);
    console.log(turnServer);
    var iceServer = createIceServer(turnServer.uris[0], turnServer.username,
                                                        turnServer.password);
    pcConfig.iceServers.push(iceServer);
    console.log("TURN server request was successful.");
  } else {
    console.log('Request for TURN server failed. Will continue call with default STUN.');
  }
  // If TURN request failed, continue the call with default STUN.
  turnDone = true;
  maybeStart();
}

function createIceServer(turn_url, username, password) {
  console.log('Your chrome version appears to be: ' + webRTCDetectedVersion);
  if (webRTCDetectedVersion < 28) {
    var iceServer = { 'url': 'turn:' + username + '@' + turn_url,
                      'credential': password };
    return iceServer;
  } else {
    var iceServer = { 'url': turn_url,
                      'credential': password,
                      'username': username };
    return iceServer;
  }
}

function resetStatus() {
  if(!initiator) {
    setStatus('Waiting for someone to join.');
  } else {
    setStatus('Initializing...')
  }
}

function doGetUserMedia(constraints) {
  try {
    getUserMedia(constraints, onUserMediaSuccess, onUserMediaError);
  } catch (e) {
    alert('getUserMedia() failed.');
    console.log('getUserMedia failed with exception: ' + e.message);
  }
}

function maybeStart() {
  if (signalingReady && localStream && channelReady && turnDone) {
    setStatus('Connecting');
    console.log('Creating PeerConnection.');
    createPeerConnection();
    console.log('Adding local stream.');
    pc.addStream(localStream);
    started = true;

    if (initiator) {
      doCall();
    } else {
      calleeStart();
    }
  } else {
    console.log("maybeStart failed.")
  }
}

function setStatus(state) {
  document.getElementById('footer').innerHTML = state;
}

function createPeerConnection() {
  try {
    // Overview of the RTCPeerConnection object:
    // Paramaters contain the information to find and access the STUN and TURN
    // servers. There may be multiple servers of each type and any TURN server
    // also acts as a STUN server. The RTCPC object has an associated ICE agent,
    // RTCPC signaling state, ICE gathering state, and ICE connection state that
    // are all initialized when the object is created.
    // The RTCPC object has two associated stream sets: a local streams set and
    // a remote streams set. The local streams set represents streams that are sent
    // and the remote streams set represents streams that are received.
    // See: http://dev.w3.org/2011/webrtc/editor/webrtc.html#rtcpeerconnection-interface for more info on the steps of creating an RTCPC
    pc = new RTCPeerConnection(pcConfig, pcConstraints);
    pc.onicecandidate = onIceCandidate;
    console.log('Created RTCPeerConnnection with:\n' +
                '  config: \'' + JSON.stringify(pcConfig) + '\';\n' +
                '  constraints: \'' + JSON.stringify(pcConstraints) + '\'.');
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    return;
  }
  pc.onaddstream = onRemoteStreamAdded;
  pc.onremovestream = onRemoteStreamRemoved;
}

function onIceCandidate(event) {
  console.log('Label: ' + event.candidate.sdpMLineIndex);
  console.log('id: ' + event.candidate.sdpMid);
  console.log('Candidate: ' + event.candidate.candidate);
  if(event.candidate) {
    sendMessage( { type: 'candidate',
                   label: event.candidate.sdpMLineIndex,
                   id: event.candidate.sdpMid,
                   candidate: event.candidate.candidate});
  } else {
    console.log('End of candidates');
  }
}

function doCall() {
  // Session Description Protocol is a format for describing streaming
  // media initialization parameters. Used for session invitation and
  // parameter negotiation
  var constraints = mergeConstraints(offerConstraints, sdpConstraints);
  console.log('Sending offer to peer with constraints: \n' +
              JSON.stringify(constraints) + '.');
  pc.createOffer(setLocalAndSendMessage, null, constraints);
}

function calleeStart() {
  // Callee starts to process cached offer and other messages.
  while (msgQueue.length > 0) {
    processSignalingMessage(msgQueue.shift());
  }
}

function doAnswer() {
  console.log('Sending answer to peer.');
  pc.createAnswer(setLocalAndSendMessage, null, sdpConstraints);
}

function mergeConstraints(cons1, cons2) {
  var merged = cons1;
  for (var name in cons2.mandatory) {
    merged.mandatory[name] = cons2.mandatory[name];
  }
  merged.optional.concat(cons2.optional);
  return merged;
}

function setLocalAndSendMessage(sessionDescription) {
  // Set Opus as the preferred codec in SDP if Opus is present
  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
  pc.setLocalDescription(sessionDescription);
  sendMessage(sessionDescription);
}

function sendMessage(message) {
  // xhr is the XMLHttpRequest API
  var msgString = JSON.stringify(message);
  console.log('Sending client to server message: ' + msgString);
  // NOTE: AppRTCClient.java searches & parses this line; update there when
  // changing here.
  path = '/message?r=' + roomKey + '&u=' + user_id;
  var xhr = new XMLHttpRequest();
  xhr.open('POST', path, true);
  xhr.send(msgString);
}

function processSignalingMessage(message) {
  if (!started) {
    console.log('peerConnection has not been created yet');
    return;
  }
  if (message.type === 'offer') {
    // Set Opus in Stereo if stereo enabled
    if (stereo) {
      message.sdp = addStereo(message.sdp);
    }
    pc.setRemoteDescription(new RTCSessionDescription(message));
    doAnswer();
  } else if (message.type === 'answer') {
    // Set Opus in Stereo if stereo enabled
    if (stereo) {
      message.sdp = addStereo(message.sdp);
    }
    pc.setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === 'candidate') {
    var candidate = new RTCIceCandidate({sdpMLineIndex: message.label,
                                         candidate: message.candidate});
    pc.addIceCandidate(candidate);
  } else if (message.type === 'bye') {
    onRemoteHangup();
  } else if (message.type === 'transition') {
    transitionToWaiting();
    stop();
    doGetUserMedia(mediaConstraints);
    signalingReady = initiator;
  }
}

function onChannelOpened() {
  console.log('Channel opened');
  channelReady = true;
  maybeStart();
}

function onChannelMessage(message) {
  console.log("Received message from server: " + message.data);
  var msg = JSON.parse(message.data);
  // Since the turn response is async and also google app engine might disorder
  // the message delivery due to possible datastore query at server side,
  // the callee needs to cache messages before peerConnection is created.
  if (!initiator && !started) {
    if (msg.type === 'offer') {
      // Add offer to beginning of msgQueue, because we can't handle early
      // candidate before offer at present
      msgQueue.unshift(msg);
      // Callee creates PeerConenction
      signalingReady = true;
      maybeStart();
    } else {
    msgQueue.push(msg);
    }
  } else {
    processSignalingMessage(msg);
  }
}

function onChannelError() {
  console.log('Channel error.');
}

function onChannelClosed() {
  console.log('Channel closed.')
}

function onUserMediaSuccess(stream) {
  console.log('User has granted access to local media');
  attachMediaStream(localVideo, stream);
  localVideo.style.opacity = 1;
  localStream = stream;
  // Caller creates PeerConnection
  maybeStart();
}

function onUserMediaError(error) {
  console.log('Failed to get access to local media. Error code was: ' +
               error.code);
}

function attachMediaStream(element, stream) {
  if (typeof element.srcObject !== 'undefined') {
    element.srcObject = stream;
  } else if (typeof element.mozScrObject !== 'undefined') {
    element.mozScrObject = stream;
  } else if (typeof element.src !== 'undefined') {
    element.src = URL.createObjectURL(stream);
  } else {
    console.log('Error attaching stream to element');
  }
}

function reattachMediaStream(to, from) {
  to.src = from.src;
}

function onRemoteStreamAdded(event) {
  console.log('Remote stream added.');
  reattachMediaStream(miniVideo, localVideo);
  attachMediaStream(remoteVideo, event.stream);
  remoteStream = event.stream;
  waitForRemoteVideo();
}

function onRemoteStreamRemoved(event) {
  console.log('Remote stream removed');
}

// This breaks after one flip
function flipLocalVideo(constraints, source) {
  var currentDomain = document.domain;
  if (currentDomain.search('localhost') === -1) {
    console.log('Transitioning localVideo source to ' + source);
    transitionToWaiting();
    stop();
    sendMessage({type: 'transition'});
    doGetUserMedia(constraints);
    signalingReady = initiator;
  } else {
    console.log('Transitioning localVideo source to ' + source);
    transitionToWaiting();
    stop();
    sendMessage({type: 'transition'});
    doGetUserMedia(mediaConstraints);
    signalingReady = initiator;
  }
}

function waitForRemoteVideo() {
  videoTracks = remoteStream.getVideoTracks();
  if (videoTracks.length === 0 || remoteVideo.currentTime > 0) {
    transitionToActive();
  } else {
    console.log("Waiting for remote video");
    setTimeout(waitForRemoteVideo, 100);
  }
}

function transitionToActive() {
  remoteVideo.style.opacity = 1;
  card.style.webkitTransform = 'rotateY(180deg)';
  setTimeout(function() { localVideo.src = ''; }, 500);
  setTimeout(function() { miniVideo.style.opacity = 1; }, 1000);
  // Reset window display according to aspect ration of remote video
  window.onresize();
  setStatus('<input type=\'button\' id=\'hangup\' value=\'Hang up\' \
            onclick=\'onHangup()\' />');
}

function transitionToWaiting() {
  card.style.webkitTransform = 'rotateY(0deg)';
  setTimeout(function() {
              localVideo.src = miniVideo.src;
              miniVideo.src = '';
              remoteVideo.src = '' }, 500);
  miniVideo.style.opacity = 0;
  remoteVideo.style.opacity = 0;
  resetStatus();
}

function transitionToDone() {
  localVideo.style.opacity = 0;
  remoteVideo.style.opacity = 0;
  miniVideo.style.opacity = 0;
  setStatus('You have left the call.');
}

function onHangup() {
  console.log('Hanging up');
  transitionToDone();
  stop();
  // Will trigger 'bye' from server
  socket.close();
}

function onRemoteHangup() {
  console.log('Session terminated by remote client.');
  initator = 0;
  transitionToWaiting();
  stop();
}

function stop() {
  started = false;
  signalingReady = false;
  pc.close();
  pc = null;
  msgQueue.length = 0;
}

// Send BYE on refreshing(or leaving) a demo page to ensure the room
// is cleaned for the next session
window.onbeforeunload = function() {
  sendMessage({type: 'bye'});
  console.log("Bye sent on refreshing page to ensure room is cleaned.");
}

// Set the video displayin in the center of window
window.onresize = function() {
    var aspectRatio;
    if (remoteVideo.style.opacity === '1') {
        aspectRatio = remoteVideo.videoWidth / remoteVideo.videoHeight;
    } else if (localVideo.style.opacity === '1') {
        aspectRatio = localVideo.videoWidth / localVideo.videoHeight;
    } else {
      return;
    }
    var innerHeight = this.innerHeight;
    var innerWidth = this.innerWidth;
    var videoWidth = innerWidth < aspectRatio * window.innerHeight ?
                     innerWidth : aspectRatio * innerHeight;
    var videoHeight = innerHeight < window.innerWidth / aspectRatio ?
                      innerHeight : window.innerWidth / aspectRatio;
    containerDiv = document.getElementById('container');
    containerDiv.style.width = videoWidth + 'px';
    containerDiv.style.height = videoHeight + 'px';
    containerDiv.style.left = (innerWidth - videoWidth) / 2 + 'px';
    containerDiv.style.top = (innerHeight - videoHeight) / 2 + 'px';
};

/////////////////////////////////////////////////////
////////////////////////////////// Opus stuff

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

$(document).ready(function(){

  var $body = $("body");

  $body.addClass("video");

  $("#flip").on("click", function() {
    var isVideo = $body.hasClass("video");
    if (isVideo) {
      flipLocalVideo(shareConstraints, "screen.");
    } else {
      flipLocalVideo(mediaConstraints, "camera.");
    }

    $body.toggleClass("video");

  });

});
