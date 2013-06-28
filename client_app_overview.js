//********** Set up (1)

// Initialize client variables
// Initialize variables from server

//********** Media (2)

// Ajax request to 'handshake' URL
// Receive server variables
// Initialize video elements
// doGetUserMedia -> attach the local media stream

// Video transitions for video on/off
// transition from one media element to another (for now just use a different website)

//****************ICE framework servers (3)

// Get a TURN server (check out maybeRequestTurn)--send an XHR request to a turn server
// Once you get a TURN server create an ice server
// onicecandidate send it as a message

//**************** Set up channel (4)

// Open a channel, set channel callbacks, and open socket
// onChannelOpened
// onChannelMessage-if you haven't started the peer connection yet, you need to
// store incoming messages and then process them after the peer connection has
// been established
// onChanneError
// onChannelClosed

//***************** Message passing (5)

// Send messages
// Processing messages (by type):
// Offer
// Answer
// Candidate
// Bye

//****************** Peer connection (6)

// Caller:
// Create the peer connection
// Add local stream to the connection
// Merge constraints and create offer (look into this method's parameters)
// Set the local description (part of above step)
// On answer -> set the remote description via onaddstream callback

// Receiver:
// On offer -> set the remote description
// Send an answer and set local description

// Both:
// Set onaddstream and onremovestream callbacks that attach appropriate media
// Clean the room after the call(window.onbeforeunload)
// Close the peer connection on hangup

//***************Codec (7)

// Just leave it for now

//**********Add

// Add buttons for each media type
