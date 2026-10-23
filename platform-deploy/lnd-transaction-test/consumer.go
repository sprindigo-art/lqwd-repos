package main

import (
	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/plain"
	"os"
	"time"
)


func InitKafka() *kafka.Reader{


	mechanism := plain.Mechanism{
		Username: os.Getenv("KAFKA_USER"),
		Password: os.Getenv("KAFKA_PASSWORD"),
	}

	dialer := &kafka.Dialer{
		Timeout:       10 * time.Second,
		DualStack:     true,
		SASLMechanism: mechanism,
	}

	return kafka.NewReader(kafka.ReaderConfig{
		Brokers:        []string{os.Getenv("KAFKA_BROKER")},
		Topic:          "lnd-invoice-monitor",
		Dialer:         dialer,
	})


}
