from pathlib import Path
from configparser import ConfigParser


def read_config(filename='database.ini', section='postgresql'):

    # create a parser
    parser = ConfigParser()
    try:
        # read config file
        my_file = Path(filename)
        if my_file.is_file():
            parser.read(filename)

            # get section, default to postgresql
            config_file = {}
            if parser.has_section(section):
                params = parser.items(section)
                for param in params:
                    config_file[param[0]] = param[1]
            else:
                raise Exception('Section {0} not found in the {1} file'.format(section, filename))
        else:
            raise Exception(f"{filename} - is not file or not found.")
    except FileNotFoundError as e:
        print(e.strerror)
    return config_file