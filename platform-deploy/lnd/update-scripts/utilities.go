package main

import (
	"bufio"
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/go-redis/redis"
	_ "github.com/go-redis/redis/v8"
	_ "github.com/lib/pq"
)

const (
	// TODO fill this in directly or through environment variable
	// Build a DSN e.g. postgres://username:password@url.com:5432/dbName
	DB_DSN = "postgres://postgres:postgresdocker%23@192.168.113.250:5433/lnd"
)

type LndStatus struct {
	ID          int
	lndNodeName string
	status      string
}

func unlock_lnd(lndNodeName string) string {

	unlock_lncli := "read"
	subProcess := exec.Command(unlock_lncli, "varname") //Just for testing, replace with your subProcess

	stdin, err := subProcess.StdinPipe()
	stdout, err := subProcess.StdoutPipe()
	if err != nil {
		fmt.Println(err) //replace with logger, or anything you want
	}
	defer stdin.Close() // the doc says subProcess.Wait will close it, but I'm not sure, so I kept this line

	subProcess.Stdout = os.Stdout
	subProcess.Stderr = os.Stderr

	fmt.Println("START")                      //for debug
	if err = subProcess.Start(); err != nil { //Use start, not run
		fmt.Println("An error occured: ", err) //replace with logger, or anything you want
	}
	io.WriteString(stdin, "Aziz\n")
	subProcess.Wait()

	r := bufio.NewReader(stdout)
	line, _, err := r.ReadLine()

	fmt.Println(line)

	fmt.Println("END") //for debug
	// fmt.Println(stdin)
	return "done"
}

func tail_logs() string {

	triger := true
	for triger {
		file, err := os.Open("main.go")
		if err != nil {
			log.Fatal(err)
		}
		defer file.Close()

		scanner := bufio.NewScanner(file)

		for scanner.Scan() {
			line := scanner.Text()
			fmt.Printf("%s\n", line)
			if strings.Contains(line, "Waiting for wallet encryption password. Use `lncli create` to create a wallet") {
				fmt.Printf("%s\v", "Waiting for Unlock")
				triger = false
			}
		}

		if err := scanner.Err(); err != nil {
			log.Fatal(err)
		}
		if triger {
			time.Sleep(3 * time.Second)
		}
	}
	return "Ready for Unlock"
}

func get_passphrase(lndKey string) string {

	rdb := redis.NewClient(&redis.Options{
		Addr:     "localhost:6379",
		Password: "secretpassword", // no password set
		DB:       0,                // use default DB
	})
	// ctx := context.Background()
	pass, err := rdb.Get(lndKey).Result()
	if err != nil {
		if err == redis.Nil {
			fmt.Println("pass does not exists")

		}
	}
	fmt.Println(pass)
	pass = decrypt_passphrase(pass)

	return pass
}

func read_file() string {
	fmt.Println("read version file")

	if _, err := os.Stat("Version"); err == nil {
		fmt.Println("checking version")

	} else if errors.Is(err, os.ErrNotExist) {
		fmt.Println("version file not exist and will be created")

	}

	content, err := ioutil.ReadFile("Version")

	if err != nil {
		log.Fatal(err)
		return string(err.Error())
	}
	return string(content)

}

func shell_command() {
	cmd := exec.Command("tr", "a-z", "A-Z")

	cmd.Stdin = strings.NewReader("and old falcon")

	var out bytes.Buffer
	cmd.Stdout = &out

	err := cmd.Run()

	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("translated phrase: %q\n", out.String())

	command := "ps -a | grep go"
	out1, err1 := exec.Command("bash", "-c", command).Output()
	// out1, err1 := cmd1.CombinedOutput()
	if err1 != nil {
		log.Fatalf("cmd.Run() failed with %s\n", err1)
	}
	fmt.Printf("combined out:\n%s\n", string(out1))

}

func stop_lnd(lndNodeName string) bool {

	cmd := exec.Command("./stop_lnd.sh")
	cmd.Stdout = os.Stdout
	err := cmd.Start()
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Runing stop subprocess %d, exiting\n", cmd.Process.Pid)
	time.Sleep(10 * time.Second)
	check_results := find_process(lndNodeName)
	if check_results != "0" {
		return false
	} else {
		return true
	}

}

func start_lnd() int {

	cmd := exec.Command("./start_lnd.sh")
	cmd.Stdout = os.Stdout
	err := cmd.Start()
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Just ran subprocess %d, exiting\n", cmd.Process.Pid)
	return cmd.Process.Pid
}

func check_process(pid string) bool {
	scommand := "ps -a | grep " + pid
	cmd := exec.Command(scommand)

	err := cmd.Run()

	if err != nil {
		log.Fatal(err)
		return false
	}
	return true
}

func get_file_size() int64 {
	info, err := os.Stat("/data/v3/" + os.Getenv("LND_PODNAME") + "/logs/bitcoin/" + os.Getenv("LND_NETWORK") + "/lnd.log")
	if err != nil {
		fmt.Println(err)
	}
	return info.Size()

}

func find_process(lndNodeName string) string {
	// scommand := "ps -aux | /data/v3/" + lndNodeName
	scommand := "ps -aux | grep /data/v3/${LND_PODNAME} "
	out, err := exec.Command("bash", "-c", scommand).Output()
	// out1, err1 := cmd1.CombinedOutput()
	if err != nil {

		log.Fatalf("cmd.Run() failed with %s\n", err)
		return "0"
	}
	arr_out := strings.Split(string(out), "\n")
	var arr_line []string

	for len(arr_out) > 0 {

		cont := strings.Contains(arr_out[0], "lnd -C /data/v3")

		if cont {
			clean_str := strings.Join(strings.Fields(arr_out[0]), " ")
			arr_line = strings.Split(clean_str, " ")

			break
		}
		arr_out = arr_out[1:]

	}
	fmt.Printf("combined out:\n%s\n ", string(out))

	if err != nil {
		log.Fatal(err)
		return "0"
	}
	fmt.Printf("process number pid: %s\n", arr_line[1])

	return arr_line[1]
}

func db_query() {

	// Create DB pool
	db, err := sql.Open("postgres", DB_DSN)
	if err != nil {
		log.Fatal("Failed to open a DB connection: ", err)
	}

	// Create an empty user and make the sql query (using $1 for the parameter)
	var lndStatus LndStatus
	userSql := "SELECT id, lnd_node_name, status FROM lnd_node_status WHERE lnd_node_name = 'tlnd-32502'"

	err = db.QueryRow(userSql).Scan(&lndStatus.ID, &lndStatus.lndNodeName, &lndStatus.status)
	if err != nil {
		log.Fatal("Failed to execute query: ", err)
	}

	fmt.Printf("Hi %s, welcome back!\n", lndStatus.status)
	defer db.Close()
}

func get_status() string {

	// Create DB pool
	db, err := sql.Open("postgres", DB_DSN)
	if err != nil {
		log.Fatal("Failed to open a DB connection: ", err)
	}

	// Create an empty user and make the sql query (using $1 for the parameter)
	var lndStatus LndStatus
	userSql := "SELECT id, lnd_node_name, status FROM lnd_node_status WHERE lnd_node_name = 'tlnd-32502'"

	err = db.QueryRow(userSql).Scan(&lndStatus.ID, &lndStatus.lndNodeName, &lndStatus.status)
	if err != nil {
		log.Fatal("Failed to execute query: ", err)
	}

	defer db.Close()
	return lndStatus.status
}
