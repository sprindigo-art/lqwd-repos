package cmd

import (
	"bytes"
	"fmt"
	"io"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
	"path/filepath"
	"strings"

	"github.com/maorfr/skbn/pkg/utils"

	core_v1 "k8s.io/api/core/v1"
)


type K8sClient struct {
	ClientSet *kubernetes.Clientset
	Config    *rest.Config
}


func DownloadFromK8s(iClient interface{}, path string, writer io.Writer) error {
	client := *iClient.(*K8sClient)
	pSplit := strings.Split(path, "/")
	if err := validateK8sPath(pSplit); err != nil {
		return err
	}
	namespace, podName, containerName, pathToCopy := initK8sVariables(pSplit)
	command := []string{"cat", pathToCopy}

	attempts := 3
	attempt := 0
	for attempt < attempts {
		attempt++

		stderr, err := Exec(client, namespace, podName, containerName, command, nil, writer)
		if attempt == attempts {
			if len(stderr) != 0 {
				return fmt.Errorf("STDERR: " + (string)(stderr))
			}
			if err != nil {
				return err
			}
		}
		if err == nil {
			return nil
		}
		utils.Sleep(attempt)
	}

	return nil
}

func Exec(client K8sClient, namespace, podName, containerName string, command []string, stdin io.Reader, stdout io.Writer) ([]byte, error) {
	clientset, config := client.ClientSet, client.Config

	req := clientset.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(podName).
		Namespace(namespace).
		SubResource("exec")

	scheme := runtime.NewScheme()
	if err := core_v1.AddToScheme(scheme); err != nil {
		return nil, fmt.Errorf("error adding to scheme: %v", err)
	}

	parameterCodec := runtime.NewParameterCodec(scheme)
	req.VersionedParams(&core_v1.PodExecOptions{
		Command:   command,
		Container: containerName,
		Stdin:     stdin != nil,
		Stdout:    stdout != nil,
		Stderr:    true,
		TTY:       false,
	}, parameterCodec)

	exec, err := remotecommand.NewSPDYExecutor(config, "POST", req.URL())
	if err != nil {
		return nil, fmt.Errorf("error while creating Executor: %v", err)
	}

	var stderr bytes.Buffer
	err = exec.Stream(remotecommand.StreamOptions{
		Stdin:  stdin,
		Stdout: stdout,
		Stderr: &stderr,
		Tty:    false,
	})
	if err != nil {
		return nil, fmt.Errorf("error in Stream: %v", err)
	}

	return stderr.Bytes(), nil
}

func validateK8sPath(pathSplit []string) error {
	if len(pathSplit) >= 3 {
		return nil
	}
	return fmt.Errorf("illegal path: %s", filepath.Join(pathSplit...))
}

func initK8sVariables(split []string) (string, string, string, string) {
	namespace := split[0]
	pod := split[1]
	container := split[2]
	path := getAbsPath(split[3:]...)

	return namespace, pod, container, path
}

func getAbsPath(path ...string) string {
	return filepath.Join("/", filepath.Join(path...))
}