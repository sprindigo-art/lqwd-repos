package lqwd.frontend.model;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Date;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class RequestsTest {

	static Requests request;
	
	@BeforeAll
	static void init() {
		request =new Requests();
	}

	@Test
	void testGetApikey() {
		request.setApikey("test");
		assertEquals("test", request.getApikey());
	}

	@Test
	void testSetApikey() {
		request.setApikey("xyz");
		assertEquals("xyz", request.getApikey());
	}

	@Test
	void testGetDate() {
		Date date =new Date();
		request.setDate(date);
		assertEquals(date, request.getDate());
	}

	@Test
	void testSetDate() {
		Date date =new Date();
		request.setDate(date);
		assertEquals(date, request.getDate());
	}

	@Test
	void testGetCommand() {
		request.setCommand("test");
		assertEquals("test", request.getCommand());
	}

	@Test
	void testSetCommand() {
		request.setCommand("xyz");
		assertEquals("xyz", request.getCommand());
	}

}
