package com.lqwd.configurationserver.models;

import java.util.List;

@lombok.Data
public class Commit {
    private List<String> changes;
}