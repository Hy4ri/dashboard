package main

import (
	"github.com/gorilla/websocket"
	"log"
	"net/http"
	"time"
)

type statsClient struct {
	conn    *websocket.Conn
	request *http.Request
	send    chan []byte
}

func (client *statsClient) write(payload []byte) {
	if !isAuthenticated(client.request) {
		client.conn.Close()
		return
	}
	client.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if err := client.conn.WriteMessage(websocket.TextMessage, payload); err != nil {
		client.conn.Close()
	}
}

func broadcastState() {
	stateMu.RLock()
	payload := lastStateJSON
	stateMu.RUnlock()
	if len(payload) == 0 {
		return
	}
	wsMu.Lock()
	clients := make([]*statsClient, 0, len(wsClients))
	for _, client := range wsClients {
		clients = append(clients, client)
	}
	wsMu.Unlock()
	for _, client := range clients {
		select {
		case client.send <- payload:
		default:
			// Keep only the newest waiting sample; never block the collector on a browser.
			select {
			case <-client.send:
			default:
			}
			select {
			case client.send <- payload:
			default:
			}
		}
	}
}

func handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WS upgrade error:", err)
		return
	}

	client := &statsClient{conn: conn, request: r, send: make(chan []byte, 1)}
	conn.SetReadLimit(4096)
	conn.SetReadDeadline(time.Now().Add(75 * time.Second))
	conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(75 * time.Second)) })
	stateMu.RLock()
	payload := lastStateJSON
	stateMu.RUnlock()
	if len(payload) > 0 {
		client.write(payload)
	}
	wsMu.Lock()
	wsClients[conn] = client
	wsMu.Unlock()
	ensureActivePolling()
	done := make(chan struct{})
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case payload := <-client.send:
				client.write(payload)
			case <-ticker.C:
				if !isAuthenticated(r) || conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
					conn.Close()
					return
				}
			}
		}
	}()

	defer func() {
		wsMu.Lock()
		delete(wsClients, conn)
		wsMu.Unlock()
		close(done)
		conn.Close()
		<-writerDone
	}()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}

var upgrader = websocket.Upgrader{}
