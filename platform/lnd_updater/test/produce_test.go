package test

import (
	"context"
	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/plain"
	"log"
	"testing"
	"time"
)

func TestProducer(t *testing.T) {
	mechanism := plain.Mechanism{
		Username: "kafka",
		Password: "user123&!$",
	}

	dialer := &kafka.Dialer{
		Timeout:       10 * time.Second,
		DualStack:     true,
		SASLMechanism: mechanism,
	}

	w := kafka.NewWriter(kafka.WriterConfig{
		Brokers: []string{"192.168.123.252:9092"},
		Topic:   "nodeUpdate-A",
		Balancer: &kafka.LeastBytes{},
		Dialer:   dialer,
	})

	err := w.WriteMessages(context.Background(),
		kafka.Message{
			Key:   []byte("NodeUpdate"),
			Value: []byte("{\"nodeName\": \"slnd-120\", \"updateStrategy\": \"SINGLE\"}"),
		},
	)

	if err != nil {
		log.Fatal("failed to write messages:", err)
	}

	if err := w.Close(); err != nil {
		log.Fatal("failed to close writer:", err)
	}
	t.Log("tested")
}
