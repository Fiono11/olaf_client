import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify, identifyPush } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import * as filters from '@libp2p/websockets/filters'
import { multiaddr, protocols } from '@multiformats/multiaddr'
import { byteStream } from 'it-byte-stream'
import { createLibp2p } from 'libp2p'
import { fromString, toString } from 'uint8arrays'

const WEBRTC_CODE = protocols('webrtc').code

const output = document.getElementById('output')
const sendSection = document.getElementById('send-section')
const appendOutput = (line) => {
  const div = document.createElement('div')
  div.appendChild(document.createTextNode(line))
  output.append(div)
}
const CHAT_PROTOCOL = '/libp2p/examples/chat/1.0.0'
const KV_PROTOCOL = '/libp2p/examples/kv/1.0.0'
const KV_QUERY_PROTOCOL = '/libp2p/examples/kv-query/1.0.0'
let ma
let chatStream

const node = await createLibp2p({
  addresses: {
    listen: [
      '/p2p-circuit',
      '/webrtc'
    ]
  },
  transports: [
    webSockets({
      filter: filters.all
    }),
    webRTC(),
    circuitRelayTransport()
  ],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  connectionGater: {
    denyDialMultiaddr: () => {
      // by default we refuse to dial local addresses from the browser since they
      // are usually sent by remote peers broadcasting undialable multiaddrs but
      // here we are explicitly connecting to a local node so do not deny dialing
      // any discovered address
      return false
    }
  },
  services: {
    identify: identify(),
    identifyPush: identifyPush(),
    ping: ping()
  }
})

await node.start()

// Automatically connect to the hardcoded relay
const HARDCODED_RELAY_ADDRESS = '/ip4/34.73.155.58/tcp/8080/ws/p2p/12D3KooWA1bysjrTACSWqf6q172inxvwKHUxAnBtVgaVDKMxpZtx'

async function connectToRelay() {
  try {
    appendOutput(`🔗 Automatically connecting to relay: ${HARDCODED_RELAY_ADDRESS}`)
    
    const relayMa = multiaddr(HARDCODED_RELAY_ADDRESS)
    const signal = AbortSignal.timeout(10000) // 10 second timeout
    
    await node.dial(relayMa, {
      signal
    })
    
    appendOutput('✅ Successfully connected to relay')
    appendOutput('📡 Ready to use SS58 address features')
    
  } catch (err) {
    if (err.name === 'AbortError') {
      appendOutput('⏰ Timed out connecting to relay')
    } else {
      appendOutput(`❌ Failed to connect to relay: ${err.message}`)
    }
  }
}

// Connect to relay automatically
connectToRelay()

function updateConnList () {
  // Update connections list
  const connListEls = node.getConnections()
    .map((connection) => {
      if (connection.remoteAddr.protoCodes().includes(WEBRTC_CODE)) {
        ma = connection.remoteAddr
        sendSection.style.display = 'block'
      } else {
        // Relay connection established
      }

      const el = document.createElement('li')
      el.textContent = connection.remoteAddr.toString()
      return el
    })
  document.getElementById('connections').replaceChildren(...connListEls)
}

node.addEventListener('connection:open', (event) => {
  updateConnList()
})
node.addEventListener('connection:close', (event) => {
  updateConnList()
})

node.addEventListener('self:peer:update', (event) => {
  // Update multiaddrs list, only show WebRTC addresses
  const multiaddrs = node.getMultiaddrs()
    .filter(ma => isWebrtc(ma))
    .map((ma) => {
      const el = document.createElement('li')
      el.textContent = ma.toString()
      return el
    })
  document.getElementById('multiaddrs').replaceChildren(...multiaddrs)
})

node.handle(CHAT_PROTOCOL, async ({ stream }) => {
  chatStream = byteStream(stream)

  while (true) {
    const buf = await chatStream.read()
    appendOutput(`Received message '${toString(buf.subarray())}'`)
  }
})



// Note: Query responses are now handled directly in the button click handlers

const isWebrtc = (ma) => {
  return ma.protoCodes().includes(WEBRTC_CODE)
}

// Connect button handler removed - now connects automatically to hardcoded relay

window.send.onclick = async () => {
  if (chatStream == null) {
    appendOutput('Opening chat stream')

    const signal = AbortSignal.timeout(5000)

    try {
      const stream = await node.dialProtocol(ma, CHAT_PROTOCOL, {
        signal
      })
      chatStream = byteStream(stream)

      Promise.resolve().then(async () => {
        while (true) {
          const buf = await chatStream.read()
          appendOutput(`Received message '${toString(buf.subarray())}'`)
        }
      })
    } catch (err) {
      if (signal.aborted) {
        appendOutput('Timed out opening chat stream')
      } else {
        appendOutput(`Opening chat stream failed - ${err.message}`)
      }

      return
    }
  }

  const message = window.message.value.toString().trim()
  appendOutput(`Sending message '${message}'`)
  chatStream.write(fromString(message))
    .catch(err => {
      appendOutput(`Error sending message - ${err.message}`)
    })
}



// Helper function to get relay connection
const getRelayConnection = () => {
  const connections = node.getConnections()
  return connections.find(conn => !conn.remoteAddr.protoCodes().includes(WEBRTC_CODE))
}



// Function to validate SS58 address format
function validatePolkadotAddress(address) {
  // Basic validation for SS58 address format
  // SS58 addresses typically start with 1, 2, 3, 4, 5, or 6 and are 47-48 characters long
  const addressRegex = /^[1-6][a-km-zA-HJ-NP-Z1-9]*[a-km-zA-HJ-NP-Z1-9][a-km-zA-HJ-NP-Z1-9]*$/
  
  if (!address || address.length < 47 || address.length > 48) {
    throw new Error('Invalid address length. SS58 addresses should be 47-48 characters long.')
  }
  
  if (!addressRegex.test(address)) {
    throw new Error('Invalid address format. SS58 addresses should start with 1-6 and contain only valid characters.')
  }
  
  return true
}







// SS58 address storage in relay
window['store-address-input'].onclick = async () => {
  const polkadotAddress = window['ss58-address-input'].value.toString().trim()
  
  if (!polkadotAddress) {
    appendOutput('Please enter a SS58 address')
    return
  }

  try {
    // Validate the SS58 address
    appendOutput('🔐 Validating SS58 address...')
    validatePolkadotAddress(polkadotAddress)
    
    appendOutput(`✅ Valid SS58 address: ${polkadotAddress}`)
    appendOutput(`🔍 Address length: ${polkadotAddress.length} characters`)
    appendOutput(`🔍 Address format check: ${polkadotAddress.match(/^[1-6]/) ? 'Valid format' : 'Unexpected format'}`)
    
    // Get relay connection
    const relayConnection = getRelayConnection()
    
    if (!relayConnection) {
      appendOutput('No relay connection found. Please connect to a relay first.')
      return
    }

    // Send the SS58 address to relay with complete multiaddress as value
    appendOutput('📤 Sending SS58 address to relay...')
    
    const stream = await node.dialProtocol(relayConnection.remoteAddr, KV_PROTOCOL, {
      signal: AbortSignal.timeout(5000)
    })
    const streamWriter = byteStream(stream)
    const streamReader = byteStream(stream)
    
    // Get the complete multiaddress for this peer
    const multiaddrs = node.getMultiaddrs()
    appendOutput(`🔍 Available multiaddresses: ${multiaddrs.map(ma => ma.toString()).join(', ')}`)
    
    // Find the direct WebRTC multiaddress (not circuit relay)
    let webrtcMultiaddr = multiaddrs.find(ma => {
      const codes = ma.protoCodes()
      return codes.includes(WEBRTC_CODE) && !codes.includes(protocols('p2p-circuit').code)
    })
    
    // Fallback to circuit relay address if no direct WebRTC address
    if (!webrtcMultiaddr) {
      appendOutput('⚠️  No direct WebRTC multiaddress found, trying circuit relay...')
      webrtcMultiaddr = multiaddrs.find(ma => ma.protoCodes().includes(WEBRTC_CODE))
    }
    
    if (!webrtcMultiaddr) {
      appendOutput('❌ No WebRTC multiaddress found. Cannot store address.')
      appendOutput('💡 Available addresses: ' + multiaddrs.map(ma => ma.toString()).join(', '))
      await stream.close()
      return
    }
    
    // Store the SS58 address as key and multiaddress as value
    const kvPair = { 
      key: polkadotAddress, 
      value: webrtcMultiaddr.toString() 
    }
    const message = JSON.stringify(kvPair)
    
    appendOutput(`📝 Storing in relay: Key=${polkadotAddress}, Value=${webrtcMultiaddr.toString()}`)
    
    await streamWriter.write(fromString(message))
    
    // Wait for response
    const response = await streamReader.read()
    
    if (response === null) {
      appendOutput(`❌ No response received from relay`)
      return
    }
    
    const responseText = toString(response.subarray())
    
    try {
      const parsed = JSON.parse(responseText)
      if (parsed.success) {
        appendOutput(`✅ Successfully stored SS58 address in relay`)
      } else {
        appendOutput(`❌ Failed to store in relay: ${parsed.error}`)
      }
    } catch (e) {
      appendOutput(`❌ Error parsing relay response: ${e.message}`)
    }
    
    await stream.close()
    
  } catch (err) {
    appendOutput(`❌ Error deriving address or sending to relay: ${err.message}`)
  }
}

// Connect to peer via SS58 address lookup
window['connect-via-address'].onclick = async () => {
  const polkadotAddress = window['ss58-address'].value.toString().trim()
  
  if (!polkadotAddress) {
    appendOutput('Please enter a SS58 address')
    return
  }

  try {
    appendOutput(`🔍 Looking up peer multiaddress for SS58 address: ${polkadotAddress}`)
    
    // Get relay connection
    const relayConnection = getRelayConnection()
    
    if (!relayConnection) {
      appendOutput('No relay connection found. Please connect to a relay first.')
      return
    }

    // Query the relay for the peer multiaddress associated with this SS58 address
    const stream = await node.dialProtocol(relayConnection.remoteAddr, KV_QUERY_PROTOCOL, {
      signal: AbortSignal.timeout(5000)
    })
    const streamWriter = byteStream(stream)
    const streamReader = byteStream(stream)
    
    const query = { action: 'get', key: polkadotAddress }
    const message = JSON.stringify(query)
    
    appendOutput(`🔍 Querying relay for key: ${polkadotAddress}`)
    
    await streamWriter.write(fromString(message))
    
    // Wait for response
    const response = await streamReader.read()
    
    if (response === null) {
      appendOutput(`❌ No response received from relay`)
      await stream.close()
      return
    }
    
    const responseText = toString(response.subarray())
    
    try {
      const parsed = JSON.parse(responseText)
      if (parsed.success && parsed.found) {
        const peerMultiaddr = parsed.value
        appendOutput(`✅ Found peer multiaddress: ${peerMultiaddr}`)
        appendOutput(`🔗 Attempting to connect to peer...`)
        
        // Close the query stream
        await stream.close()
        
        // Now try to connect to the peer using the found multiaddress
        try {
          appendOutput(`📡 Dialing peer: ${peerMultiaddr}`)
          
          const dialSignal = AbortSignal.timeout(10000) // 10 second timeout for peer connection
          
          // Use the multiaddr constructor to ensure proper parsing
          const ma = multiaddr(peerMultiaddr)
          appendOutput(`📡 Parsed multiaddress: ${ma.toString()}`)
          
          // Check if this is a circuit relay address
          const isCircuitRelay = ma.protoCodes().includes(protocols('p2p-circuit').code)
          if (isCircuitRelay) {
            appendOutput(`⚠️  This is a circuit relay address. Connection might be slower.`)
          }
          
          await node.dial(ma, {
            signal: dialSignal
          })
          
          appendOutput(`✅ Successfully connected to peer`)
          appendOutput(`🎉 You can now send messages to this peer!`)
          
        } catch (dialError) {
          if (dialError.name === 'AbortError') {
            appendOutput(`⏰ Timed out connecting to peer`)
          } else {
            appendOutput(`❌ Failed to connect to peer: ${dialError.message}`)
            appendOutput(`💡 The peer might be offline or not reachable`)
            appendOutput(`💡 Try copying the multiaddress and pasting it in the Remote MultiAddress field`)
            appendOutput(`💡 Multiaddress: ${peerMultiaddr}`)
          }
        }
        
      } else if (parsed.success && !parsed.found) {
        appendOutput(`❌ No peer found for SS58 address: ${polkadotAddress}`)
        appendOutput(`💡 The address might not be registered or the peer might be offline`)
      } else {
        appendOutput(`❌ Query failed: ${parsed.error}`)
      }
    } catch (e) {
      appendOutput(`❌ Error parsing relay response: ${e.message}`)
    }
    
    await stream.close()
    
  } catch (err) {
    appendOutput(`❌ Error looking up peer or connecting: ${err.message}`)
  }
}

