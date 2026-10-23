package com.lqwd.model.tink;

import lombok.Data;

import java.util.List;

@Data
public class TinkSecret{
    private int primaryKeyId;
    private List<Key> key;
}

