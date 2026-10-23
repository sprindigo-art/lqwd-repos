package com.lqwd.repository;

import com.lqwd.model.entities.LndAddress;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;


@Repository
public interface LndAddressRepository extends JpaRepository<LndAddress, Long> {

    List<LndAddress> findByNodeName(String nodeName);
}
