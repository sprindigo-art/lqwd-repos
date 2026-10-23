# backend

### Requirements
python3\
pip3

### Setting up the project

#### change directory to project directory
```console
foo@bar:~$ cd py-backend
```
#### create a virtual environment name venv
```console
foo@bar:~$ python3 -m venv venv
```
#### install dependencies
```console
foo@bar:~ pip install -r requirements.txt
```
#### run py-backend
```console
foo@bar:~ python3 app/client.py --debug --grpc
```

#### test py-backend
```console
foo@bar:~ python3 app/tests/confluent_producer_test.py --topic request  --action fees --debug
```