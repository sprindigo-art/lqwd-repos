package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io/ioutil"
	"lnd_updater/cmd"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl/plain"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

type Message struct {
	NodeName       string `json:"nodeName,omitempty"`
	UpdateStrategy string `json:"updateStrategy,omitempty"`
}

func main() {

	isInCluster := flag.Bool("inCluster", false, "is update running in cluster")
	flag.Parse()

	clientConfig := getClientConfig(isInCluster)

	// create the clientSet
	clientSet, err := kubernetes.NewForConfig(clientConfig)

	if err != nil {
		panic(err.Error())
	}

	kafkaReader := initKafkaReader()

	log.Println("Yay! Kafka initialized and listening for new instructions")
	for {

		m, err := kafkaReader.ReadMessage(context.Background())
		if err != nil {
			log.Printf("%v", err)
			break
		}

		log.Printf("message at topic/partition/offset %v/%v/%v: %s = %s\n",
			m.Topic, m.Partition, m.Offset, string(m.Key), string(m.Value))

		var message Message
		err = json.Unmarshal(m.Value, &message)

		if err != nil {
			log.Printf("%v", err)
		}

		if message.UpdateStrategy == "SINGLE" {

			if len(message.NodeName) == 0 {
				log.Println("SINGLE update strategy requires a node name")
			} else {
				handleSingleNodeUpdate(message, clientSet, clientConfig)
			}

		} else {

			handleMultipleNodeUpdates(clientSet, clientConfig)

		}

	}

	if err := kafkaReader.Close(); err != nil {
		log.Fatal("failed to close reader:", err)
	}

}

func handleMultipleNodeUpdates(clientSet *kubernetes.Clientset, clientConfig *rest.Config) {

	pods, err := clientSet.CoreV1().Pods("lqwd-lnd").List(context.TODO(), metav1.ListOptions{})

	if err != nil {
		log.Printf("An error occurred wheb geting pod list: %v", err.Error())
		return
	}

	for _, pod := range pods.Items {

		if !backupChannelDB(pod, clientSet, clientConfig) {
			continue
		}

		err := clientSet.CoreV1().Pods(pod.Namespace).Delete(context.TODO(), pod.Name, metav1.DeleteOptions{})

		if err != nil {
			log.Println(err)
			continue
		}

	}
}

func handleSingleNodeUpdate(message Message, clientSet *kubernetes.Clientset, clientConfig *rest.Config) {
	label := labels.Set{"app": message.NodeName}

	pods, err := clientSet.CoreV1().Pods("lqwd-lnd").List(context.TODO(),
		metav1.ListOptions{LabelSelector: label.AsSelector().String()})

	if err != nil {
		log.Printf("an error occurred when getting deployment: %v", err)
		return
	}

	if !backupChannelDB(pods.Items[0], clientSet, clientConfig) {
		log.Printf("failed to backup channel.db")

	} else {

		err := clientSet.CoreV1().Pods(pods.Items[0].Namespace).Delete(context.TODO(), pods.Items[0].Name,
			metav1.DeleteOptions{})

		if err != nil {
			log.Printf("an error occurred when deleting pod: %v", err)
		} else {
			log.Println("New instance launched successfully")
		}
	}
}

func initKafkaReader() *kafka.Reader {
	mechanism := plain.Mechanism{
		Username: os.Getenv("KAFKA_USER"),
		Password: os.Getenv("KAFKA_PASSWORD"),
	}

	dialer := &kafka.Dialer{
		Timeout:       10 * time.Second,
		DualStack:     true,
		SASLMechanism: mechanism,
	}

	kafkaReader := kafka.NewReader(kafka.ReaderConfig{
		Brokers: []string{os.Getenv("KAFKA_BROKER")},
		GroupID: os.Getenv("GROUP_ID"),
		Topic:   os.Getenv("TOPIC"),
		Dialer:  dialer,
	})
	return kafkaReader
}

func getClientConfig(isInCluster *bool) *rest.Config {
	if !*isInCluster {

		config, err := outOfClusterConfig()

		if err != nil {
			panic(err.Error())
		}

		return config

	} else {

		config, err := initConfig()

		if err != nil {
			panic(err.Error())
		}

		return config
	}
}

func initConfig() (*rest.Config, error) {

	configContent, err := ioutil.ReadFile("config-kubernetes.yml")

	if err != nil {
		return nil, err
	}

	content := fmt.Sprintf(string(configContent),os.Getenv("CERT_DATA"), os.Getenv("{}"),
		os.Getenv("K8TOKEN"))

	err = os.WriteFile("config.yml", []byte(content), 0644)

	if err != nil {
		return nil, err
	}

	kubeConfig := flag.String("kubeconfig", "config.yml", "kubeconfig file")

	flag.Parse()

	//// use the current context in kubeconfig
	config, err := clientcmd.BuildConfigFromFlags("", *kubeConfig)

	if err != nil {
		return nil, err
	}

	return config, nil
}

func outOfClusterConfig() (*rest.Config, error) {
	var kubeConfig *string

	if home := homedir.HomeDir(); home != "" {
		kubeConfig = flag.String("kubeconfig", filepath.Join(home, "Documents", "config"), "(optional) absolute path to the kubeconfig file")
	} else {
		kubeConfig = flag.String("kubeconfig", "", "absolute path to the kubeconfig file")
	}
	flag.Parse()

	// use the current context in kubeconfig
	config, err := clientcmd.BuildConfigFromFlags("", *kubeConfig)

	if err != nil {
		return nil, err
	}

	return config, nil
}

func backupChannelDB(pod v1.Pod, clientSet *kubernetes.Clientset, config *rest.Config) bool {

	network := "regtest"

	if strings.HasPrefix(pod.Name, "slnd") {
		network = "regtest"
	} else if strings.HasPrefix(pod.Name, "mlnd") {
		network = "mainnet"
	} else if strings.HasPrefix(pod.Name, "tlnd") {
		network = "testnet"
	} else {
		return false
	}

	src := fmt.Sprintf("lqwd-lnd/%s/%s/data/v3/%s/data/chain/bitcoin/%s/channel.backup",
		pod.Name, pod.Spec.Containers[0].Name, pod.Labels["app"], network)
	des := fmt.Sprintf("%s.backup", pod.Labels["app"])

	file, err := os.Create(des)

	if err != nil {
		fmt.Printf("%v\n", err)
		return false
	}

	cmd.DownloadFromK8s(&cmd.K8sClient{ClientSet: clientSet, Config: config}, src, file)

	return true
}
